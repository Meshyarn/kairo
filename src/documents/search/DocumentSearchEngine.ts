import { NativeSearchError, type NativeSearchCoreClient } from "../../engine/search/native/NativeSearchCore.js";
import { DocumentChunkRepository, StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";
import { EmbeddingRepository } from "../../indexing/EmbeddingRepository.js";
import { DocumentIndexer } from "../../indexing/DocumentIndexer.js";
import type { IndexDatabase } from "../../indexing/IndexDatabase.js";
import { EmbeddingProviderFactory } from "../../embeddings/EmbeddingProviderFactory.js";
import { EmbeddingTimeoutError } from "../../embeddings/EmbeddingQueue.js";
import { computeEmbeddingDiagnostics, isHashModel } from "../../embeddings/EmbeddingDiagnostics.js";
import { LRUCache } from "lru-cache";
import { EvidencePackRepository, computeRootFingerprint } from "../../indexing/EvidencePackRepository.js";
import { metrics } from "../../utils/MetricsCollector.js";
import { VectorIndexManager } from "../../vector/VectorIndexManager.js";
import type { DocumentSearchOptions, DocumentSearchResponse } from "./SearchTypes.js";
import { buildStaleCheckItems, fillPreviewsFromSummaries, hydrateResponseFromPack, toStoredItems } from "./EvidencePackBuilder.js";
import { normalizeSearchQuery, computePackId, mergeEmbeddingConfig } from "./QueryParsing.js";
import { isMetricsPath } from "./SearchFilters.js";
import { applyMmr, buildRankMap, computeSimilarity, tokenize } from "./ResultRanking.js";
import { limitEvidence, toSearchSection } from "./SnippetExtractor.js";
import { collectAnnChunks, embedQuery, ensureEmbeddings, resolveEmbeddingProvider } from "./DocumentSearchEmbeddings.js";
import { attachFileMeta, collectNativeChunks, isPackStale } from "./DocumentSearchEngineHelpers.js";
import { buildEmptyQueryResponse, handleNoChunks } from "./DocumentSearchEngineResponses.js";
import { buildRrfScores, trimLexicalChunks } from "./DocumentSearchEngineRanking.js";
import { clampDocLimit, isTestEnv, limitCandidateFiles, uniqueCandidateFiles } from "./DocumentSearchEngineUtils.js";

export class DocumentSearchEngine {
    private readonly packCache: LRUCache<string, { response: DocumentSearchResponse; createdAt: number; expiresAt?: number; staleCheckItems: Array<{ chunkId: string; snapshot?: { contentHash?: string } }> }>;
    private readonly nativeSearchCore: NativeSearchCoreClient;
    private readonly repoId: string;

    constructor(
        private readonly documentIndexer: DocumentIndexer,
        private readonly chunkRepository: DocumentChunkRepository,
        private readonly embeddingRepository: EmbeddingRepository,
        private readonly embeddingFactory: EmbeddingProviderFactory,
        private readonly rootPath: string,
        private readonly symbolIndex?: { getSymbolsForFile(filePath: string): Promise<unknown> },
        private readonly evidencePacks?: EvidencePackRepository,
        private readonly vectorIndexManager?: VectorIndexManager,
        private readonly indexDatabase?: IndexDatabase,
        nativeSearchCore?: NativeSearchCoreClient,
        repoId?: string
    ) {
        const max = Number.parseInt(process.env.KAIRO_EVIDENCE_PACK_CACHE_SIZE ?? "100", 10);
        this.packCache = new LRUCache({ max: Number.isFinite(max) && max > 0 ? max : 100 });
        if (!nativeSearchCore) {
            throw new Error("Native search core is required for document search.");
        }
        this.nativeSearchCore = nativeSearchCore;
        this.repoId = repoId ?? "default";
    }

    public evictPackCache(packIds?: string[]): void {
        if (!packIds || packIds.length === 0) {
            this.packCache.clear();
            return;
        }
        for (const packId of packIds) {
            this.packCache.delete(packId);
        }
    }

    public async getEmbeddingStatus(): Promise<{ provider: string; model: string; dims: number } | null> {
        try {
            const provider = await this.embeddingFactory.getProvider();
            return {
                provider: provider.provider,
                model: provider.model,
                dims: provider.dims
            };
            } catch {
            return null;
            }
    }

    public async search(query: string, options: DocumentSearchOptions = {}): Promise<DocumentSearchResponse> {
            const stopTotal = metrics.startTimer("docs.search.total_ms");
            const output = options.output ?? "full";
            const packTtlMs = Number.parseInt(process.env.KAIRO_EVIDENCE_PACK_TTL_MS ?? "86400000", 10); // 24h
            const scope = options.scope ?? "all";
            const includeLogs = options.includeLogs === true;
            const includeMetrics = options.includeMetrics === true;
        try {
            const normalizedQuery = normalizeSearchQuery(query);
            if (!normalizedQuery) {
                return buildEmptyQueryResponse(query);
            }
            const maxResults = options.maxResults ?? (output === "compact" ? 6 : 8);
            const maxCandidates = clampDocLimit(options.maxCandidates ?? 60, "KAIRO_DOC_MAX_CANDIDATES");
            const maxChunkCandidates = clampDocLimit(options.maxChunkCandidates ?? 400, "KAIRO_DOC_MAX_CHUNK_CANDIDATES");
            const maxVectorCandidates = clampDocLimit(options.maxVectorCandidates ?? 60, "KAIRO_DOC_MAX_VECTOR_CANDIDATES");
            const maxEvidenceSections = options.maxEvidenceSections ?? (output === "compact" ? Math.max(maxResults * 2, 8) : Math.max(maxResults * 3, 12));
            const maxEvidenceChars = options.maxEvidenceChars ?? (output === "compact" ? 2200 : 8000);
            const includeEvidence = options.includeEvidence ?? (output === "full");
            const snippetLength = options.snippetLength ?? (output === "compact" ? 120 : 240);
            const rrfK = options.rrfK ?? 60;
            const rrfDepth = options.rrfDepth ?? 200;
            const useMmr = options.useMmr !== false;
            const mmrLambda = options.mmrLambda ?? 0.7;
            const maxChunksEmbeddedPerRequest = options.maxChunksEmbeddedPerRequest ?? 32;
            const maxEmbeddingTimeMs = options.maxEmbeddingTimeMs ?? 2500;
            const degradationReasons: string[] = [];
            const effectivePackId = options.packId ?? computePackId(normalizedQuery, {
                output,
                maxResults,
                maxCandidates,
                maxChunkCandidates,
                maxVectorCandidates,
                maxEvidenceSections,
                maxEvidenceChars,
                includeEvidence,
                snippetLength,
                rrfK,
                rrfDepth,
                useMmr,
                mmrLambda,
                maxChunksEmbeddedPerRequest,
                maxEmbeddingTimeMs,
                includeComments: options.includeComments === true,
                includeLogs,
                includeMetrics,
                scope,
                embedding: options.embedding ?? null
            });

            const cached = this.packCache.get(effectivePackId);
            if (cached) {
                const now = Date.now();
                if (!cached.expiresAt || cached.expiresAt > now) {
                    const stale = await isPackStale({ items: cached.staleCheckItems ?? [], chunkRepository: this.chunkRepository });
                    if (!stale) {
                        metrics.inc("cache.docs_pack.hit_total");
                        return attachFileMeta({
                            response: {
                                ...cached.response,
                                pack: {
                                    packId: effectivePackId,
                                    hit: true,
                                    createdAt: cached.createdAt,
                                    expiresAt: cached.expiresAt
                                }
                            },
                            indexDatabase: this.indexDatabase
                        });
                    }
                    this.packCache.delete(effectivePackId);
                }
                this.packCache.delete(effectivePackId);
            }

            // Persistent pack lookup (Phase 2): enables reuse across engine instances.
            if (this.evidencePacks) {
                const stored = this.evidencePacks.getPack(effectivePackId);
                if (stored && stored.rootFingerprint === computeRootFingerprint(this.rootPath)) {
                    const stale = await isPackStale({ items: stored.items, chunkRepository: this.chunkRepository });
                    if (!stale) {
                        const responseFromDb = hydrateResponseFromPack(stored, output, includeEvidence);
                        const createdAt = stored.createdAt;
                        const expiresAt = stored.expiresAt;
                        const staleCheckItems = (stored.items ?? [])
                            .map(item => ({ chunkId: item.chunkId, snapshot: { contentHash: item.snapshot?.contentHash } }))
                            .filter(item => Boolean(item.snapshot?.contentHash));
                        this.packCache.set(effectivePackId, { response: responseFromDb, createdAt, expiresAt, staleCheckItems });
                        metrics.inc("cache.docs_pack.hit_total");
                        return attachFileMeta({
                            response: {
                                ...responseFromDb,
                                pack: { packId: effectivePackId, hit: true, createdAt, expiresAt }
                            },
                            indexDatabase: this.indexDatabase
                        });
                    }
                }
            }

            metrics.inc("cache.docs_pack.miss_total");
            let native: { chunks: StoredDocumentChunk[]; scoreMap: Map<string, number>; rankMap: Map<string, number>; rankedIds: string[] };
            try {
                native = await collectNativeChunks({
                    nativeSearchCore: this.nativeSearchCore,
                    chunkRepository: this.chunkRepository,
                    repoId: this.repoId,
                    query: normalizedQuery,
                    options: {
                        maxCandidates: maxChunkCandidates,
                        scope,
                        includeComments: options.includeComments === true,
                        includeLogs,
                        includeMetrics
                    }
                });
            } catch (error) {
                degradationReasons.push(error instanceof NativeSearchError ? error.code : "native_search_failed");
                native = { chunks: [], scoreMap: new Map(), rankMap: new Map(), rankedIds: [] };
            }
            let chunks: StoredDocumentChunk[] = native.chunks;
            let candidateChunkCount = chunks.length;
            let bm25ScoreMap = native.scoreMap;
            let bm25RankMap = native.rankMap;
            let lexicalRankedIds: string[] = native.rankedIds;
            metrics.gauge("docs.search.candidate_chunks", candidateChunkCount);

            if (chunks.length > maxChunkCandidates) {
            degradationReasons.push("budget_exceeded");
            chunks = trimLexicalChunks({ chunks, normalizedQuery, maxChunkCandidates });
            }
            let candidateFiles = uniqueCandidateFiles(chunks);

            if (chunks.length === 0) {
                return handleNoChunks({
                    query,
                    includeEvidence,
                    candidateFiles,
                    degradationReasons,
                    packCache: this.packCache,
                    effectivePackId,
                    packTtlMs,
                    options,
                    output,
                    snippetLength,
                    maxEvidenceChars,
                    maxEvidenceSections,
                    maxResults,
                    rootPath: this.rootPath,
                    evidencePacks: this.evidencePacks,
                    indexDatabase: this.indexDatabase
                });
            }

            const provider = await resolveEmbeddingProvider(this.embeddingFactory, options.embedding);
            const embeddingConfig = options.embedding
            ? mergeEmbeddingConfig(this.embeddingFactory.getConfig(), options.embedding)
            : this.embeddingFactory.getConfig();
            const embeddingDiagnostics = computeEmbeddingDiagnostics({ config: embeddingConfig });
            let vectorEnabled = provider.provider !== "disabled";
            let vectorScores = new Map<string, number>();
            let vectorRankMap = new Map<string, number>();
            let degraded = false;
            const metricsBoost = includeMetrics
            ? Number.parseFloat(process.env.KAIRO_METRICS_SCORE_BOOST ?? "0.12")
            : 0;
            let queryVector: Float32Array | undefined;

            if (!isTestEnv()) {
            if (embeddingDiagnostics.remoteDownloadsAllowed) {
                degradationReasons.push("embeddings_remote_enabled");
            }
            const modelId = embeddingDiagnostics.modelId;
            if (modelId && !isHashModel(modelId) && embeddingDiagnostics.missingAssets && embeddingDiagnostics.missingAssets.length > 0) {
                degradationReasons.push(embeddingDiagnostics.resolvedModelRoot
                    ? "embeddings_local_model_incomplete"
                    : "embeddings_local_model_missing");
            }
            if (provider.model && !isHashModel(modelId) && isHashModel(provider.model)) {
                degradationReasons.push("embeddings_fallback_hash");
            }
            }

            if (vectorEnabled) {
            const queryEmbedding = await embedQuery(normalizedQuery, provider);
            if (queryEmbedding.vector) {
                queryVector = queryEmbedding.vector;
                if (queryEmbedding.degraded) {
                    degraded = true;
                    if (queryEmbedding.reasons.length > 0) {
                        degradationReasons.push(...queryEmbedding.reasons);
                    }
                }
            } else {
                degraded = true;
                vectorEnabled = false;
                if (queryEmbedding.reasons.length > 0) {
                    degradationReasons.push(...queryEmbedding.reasons);
                } else {
                    degradationReasons.push("vector_disabled");
                }
            }
            }

            let annChunks: StoredDocumentChunk[] = [];
            if (vectorEnabled && queryVector && this.vectorIndexManager?.isEnabled()) {
            const annResult = await collectAnnChunks(queryVector, provider, {
                scope,
                includeComments: options.includeComments === true,
                includeLogs,
                includeMetrics,
                maxCandidates: maxVectorCandidates
            }, this.chunkRepository, this.vectorIndexManager);
            if (annResult.degraded) {
                degraded = true;
                if (annResult.reasons.length > 0) {
                    degradationReasons.push(...annResult.reasons);
                }
            }
            annChunks = annResult.chunks;
            if (annChunks.length > 0) {
                const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
                for (const chunk of annChunks) {
                    if (!byId.has(chunk.id)) {
                        byId.set(chunk.id, chunk);
                    }
                }
                chunks = Array.from(byId.values());
                candidateChunkCount = chunks.length;
                metrics.gauge("docs.search.candidate_chunks", candidateChunkCount);
            }
            }
            const limited = limitCandidateFiles(chunks, lexicalRankedIds, bm25ScoreMap, maxCandidates);
            if (limited.trimmed) {
            degradationReasons.push("budget_exceeded");
            chunks = limited.chunks;
            lexicalRankedIds = limited.lexicalRankedIds;
            bm25ScoreMap = limited.bm25ScoreMap;
            bm25RankMap = buildRankMap(lexicalRankedIds);
            candidateChunkCount = chunks.length;
            metrics.gauge("docs.search.candidate_chunks", candidateChunkCount);
            }
            candidateFiles = limited.candidateFiles;

            if (vectorEnabled) {
            const candidateMap = new Map<string, StoredDocumentChunk>();
            for (const docId of lexicalRankedIds.slice(0, Math.min(maxVectorCandidates, lexicalRankedIds.length))) {
                const chunk = chunks.find(entry => entry.id === docId);
                if (chunk) candidateMap.set(chunk.id, chunk);
            }
            if (annChunks.length > 0) {
                for (const chunk of annChunks) {
                    if (!candidateMap.has(chunk.id)) {
                        candidateMap.set(chunk.id, chunk);
                    }
                }
            }
            const candidateChunks = Array.from(candidateMap.values());

            try {
                if (!queryVector) {
                    throw new Error("Missing query vector");
                }
                const embeddingResult = await ensureEmbeddings(
                    queryVector,
                    candidateChunks,
                    provider,
                    { maxChunks: maxChunksEmbeddedPerRequest, maxTimeMs: maxEmbeddingTimeMs },
                    this.embeddingRepository,
                    this.vectorIndexManager
                );

                degraded = embeddingResult.degraded;
                if (embeddingResult.reasons.length > 0) {
                    degradationReasons.push(...embeddingResult.reasons);
                }
                vectorScores = embeddingResult.scores;
                const vectorRanked = Array.from(vectorScores.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, rrfDepth);
                vectorRankMap = buildRankMap(vectorRanked.map(([id]) => id));
            } catch (err: any) {
                degraded = true;
                if (err instanceof EmbeddingTimeoutError) {
                    degradationReasons.push("embedding_timeout");
                } else {
                    degradationReasons.push("vector_disabled");
                }
                vectorEnabled = false;
                vectorScores = new Map();
                vectorRankMap = new Map();
            }
            }

            const rrfScores = buildRrfScores({ bm25RankMap, vectorRankMap, rrfDepth, rrfK });

            const scoredSections = chunks.map(chunk => {
            const bm25Score = bm25ScoreMap.get(chunk.id) ?? 0;
            const vectorScore = vectorScores.get(chunk.id);
            const baseScore = vectorEnabled ? (rrfScores.get(chunk.id) ?? 0) : bm25Score;
            const finalScore = (metricsBoost > 0 && isMetricsPath(chunk.filePath))
                ? baseScore * (1 + metricsBoost)
                : baseScore;
            return {
                chunk,
                scores: {
                    bm25: bm25Score,
                    vector: vectorScore,
                    final: finalScore
                }
            };
            }).sort((a, b) => b.scores.final - a.scores.final);

            const similarityCache = new Map<string, number>();
            const tokenCache = new Map<string, Set<string>>();
            const vectorCache = vectorEnabled ? new Map<string, Float32Array>() : null;
            if (vectorEnabled && vectorScores.size > 0) {
            for (const chunk of chunks) {
                const stored = this.embeddingRepository.getEmbedding(chunk.id, provider.provider, provider.model);
                if (stored?.vector) {
                    vectorCache?.set(chunk.id, stored.vector);
                }
            }
            }
            for (const chunk of chunks) {
            tokenCache.set(chunk.id, new Set(tokenize(chunk.text)));
            }

            const ordered = useMmr
            ? applyMmr(scoredSections, mmrLambda, maxEvidenceSections, (a, b) => {
                const key = `${a}|${b}`;
                if (similarityCache.has(key)) return similarityCache.get(key) ?? 0;
                const similarity = computeSimilarity(a, b, vectorCache, tokenCache);
                similarityCache.set(key, similarity);
                return similarity;
            })
            : scoredSections;

            const results = ordered.slice(0, maxResults).map(entry => toSearchSection(entry.chunk, entry.scores, snippetLength));
            const evidenceCandidates = includeEvidence
            ? ordered.map(entry => toSearchSection(entry.chunk, entry.scores, snippetLength))
            : [];
            const evidence = includeEvidence
            ? limitEvidence(evidenceCandidates, maxEvidenceSections, maxEvidenceChars)
            : undefined;

            // Phase 3: store/reuse deterministic previews in chunk_summaries to reduce repeated payload work.
            if (this.evidencePacks) {
            const byId = new Map(chunks.map(c => [c.id, c]));
            fillPreviewsFromSummaries(results, byId, normalizedQuery, snippetLength, this.evidencePacks);
            if (Array.isArray(evidence)) {
                fillPreviewsFromSummaries(evidence, byId, normalizedQuery, snippetLength, this.evidencePacks);
            }
            }

            const evidenceChars = (evidence ?? []).reduce((sum, section) => sum + (section.preview?.length ?? 0), 0);
            const evidenceTruncated = includeEvidence && evidence != null && evidence.length < evidenceCandidates.length;
            if (evidenceTruncated) {
            degradationReasons.push("evidence_truncated");
            }

            const uniqueReasons = Array.from(new Set(degradationReasons.filter(Boolean)));
            const degradedAny = degraded || uniqueReasons.length > 0;
            const reason = uniqueReasons.length > 0 ? uniqueReasons[0] : undefined;
            const reasons = uniqueReasons.length > 1 ? uniqueReasons : undefined;

            const response: DocumentSearchResponse = {
            query,
            results: output === "pack_only" ? results.map(r => ({ ...r, preview: "" })) : results,
            evidence: includeEvidence
                ? (output === "pack_only"
                    ? (evidence ?? []).map(e => ({ ...e, preview: "" }))
                    : evidence)
                : undefined,
            degraded: degradedAny,
            reason,
            reasons,
            provider: vectorEnabled ? { name: provider.provider, model: provider.model, dims: provider.dims } : null,
            stats: {
                candidateFiles: candidateFiles.length,
                candidateChunks: candidateChunkCount,
                vectorEnabled,
                mmrApplied: useMmr,
                evidenceSections: evidence?.length ?? 0,
                evidenceChars,
                evidenceTruncated
            }
            };
            if (degradedAny) {
            metrics.inc("docs.search.degraded_total");
            }

            const createdAt = Date.now();
            const expiresAt = Number.isFinite(packTtlMs) && packTtlMs > 0 ? createdAt + packTtlMs : undefined;
            const staleCheckItems = buildStaleCheckItems(results, evidence, includeEvidence, chunks);
            this.packCache.set(effectivePackId, { response, createdAt, expiresAt, staleCheckItems });
            if (this.evidencePacks) {
            try {
                const storedItems = toStoredItems(results, evidence, includeEvidence, chunks, bm25ScoreMap, vectorScores, vectorEnabled);
                this.evidencePacks.upsertPack({
                    packId: effectivePackId,
                    query,
                    createdAt,
                    expiresAt,
                    rootFingerprint: computeRootFingerprint(this.rootPath),
                    options: { ...options, output, includeEvidence, snippetLength, maxEvidenceChars, maxEvidenceSections, maxResults },
                    meta: { degraded: response.degraded, reason: response.reason, reasons: response.reasons, provider: response.provider, stats: response.stats as any },
                    items: storedItems
                });
            } catch {
                // best-effort
            }
            }
            return attachFileMeta({
                response: {
                    ...response,
                    pack: { packId: effectivePackId, hit: false, createdAt, expiresAt }
                },
                indexDatabase: this.indexDatabase
            });
        } finally {
            stopTotal();
        }
    }
}
