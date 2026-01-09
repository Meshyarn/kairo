import { EmbeddingProviderFactory } from "../../embeddings/EmbeddingProviderFactory.js";
import { EmbeddingTimeoutError } from "../../embeddings/EmbeddingQueue.js";
import { applyEmbeddingPrefix } from "../../embeddings/EmbeddingText.js";
import { DocumentChunkRepository, StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";
import { EmbeddingRepository } from "../../indexing/EmbeddingRepository.js";
import type { EmbeddingConfig } from "../../types.js";
import { metrics } from "../../utils/MetricsCollector.js";
import { VectorIndexManager } from "../../vector/VectorIndexManager.js";
import { cosineSimilarity, l2Norm } from "./ResultRanking.js";
import { mergeEmbeddingConfig } from "./QueryParsing.js";
import { matchesDocScope } from "./SearchFilters.js";

export type EmbeddingProvider = {
    provider: string;
    model: string;
    dims: number;
    normalize: boolean;
    embed(texts: string[]): Promise<Float32Array[]>;
};

export async function ensureEmbeddings(
    queryVector: Float32Array,
    chunks: StoredDocumentChunk[],
    provider: EmbeddingProvider,
    limits: { maxChunks: number; maxTimeMs: number },
    embeddingRepository: EmbeddingRepository,
    vectorIndexManager?: VectorIndexManager
): Promise<{ scores: Map<string, number>; degraded: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    const scores = new Map<string, number>();
    const missing: StoredDocumentChunk[] = [];

    const stopVectorScore = metrics.startTimer("docs.search.vector_scoring_ms");
    try {
        for (const chunk of chunks) {
            const stored = embeddingRepository.getEmbedding(chunk.id, provider.provider, provider.model);
            if (stored?.vector && stored.vector.length > 0) {
                if (provider.dims === 0) {
                    provider.dims = stored.dims;
                }
                scores.set(chunk.id, cosineSimilarity(stored.vector, queryVector));
            } else {
                missing.push(chunk);
            }
        }
    } finally {
        stopVectorScore();
    }

    if (missing.length === 0) {
        return { scores, degraded: false, reasons: [] };
    }

    const startedAt = Date.now();
    let degraded = false;
    const limited = missing.slice(0, limits.maxChunks);
    if (missing.length > limits.maxChunks) {
        degraded = true;
        reasons.push("embedding_partial");
    }

    const batchSize = Math.max(1, Math.min(limits.maxChunks, 16));
    for (let i = 0; i < limited.length; i += batchSize) {
        const elapsed = Date.now() - startedAt;
        if (elapsed > limits.maxTimeMs) {
            degraded = true;
            reasons.push("embedding_timeout");
            break;
        }
        const batch = limited.slice(i, i + batchSize);
        let vectors: Float32Array[];
        try {
            const stopBatchEmbed = metrics.startTimer("docs.search.embedding_chunks_ms");
            try {
                const batchTexts = batch.map(chunk => chunk.text);
                const prefixed = applyEmbeddingPrefix(batchTexts, "passage", provider.model);
                vectors = await provider.embed(prefixed);
            } finally {
                stopBatchEmbed();
            }
        } catch (err: any) {
            degraded = true;
            if (err instanceof EmbeddingTimeoutError) {
                reasons.push("embedding_timeout");
            } else {
                reasons.push("vector_disabled");
            }
            break;
        }
        for (let idx = 0; idx < batch.length; idx += 1) {
            const chunk = batch[idx];
            const vector = vectors[idx];
            if (!vector) continue;
            if (provider.dims === 0) {
                provider.dims = vector.length;
            }
            embeddingRepository.upsertEmbedding(chunk.id, {
                provider: provider.provider,
                model: provider.model,
                dims: vector.length,
                vector,
                norm: l2Norm(vector)
            });
            vectorIndexManager?.indexItem({
                id: chunk.id,
                metadata: {
                    type: "doc",
                    filePath: chunk.filePath || ""
                },
                embedding: {
                    provider: provider.provider,
                    model: provider.model,
                    dims: vector.length,
                    vector
                }
            });
            scores.set(chunk.id, cosineSimilarity(vector, queryVector));
        }
    }

    return { scores, degraded, reasons: Array.from(new Set(reasons)) };
}

export async function embedQuery(
    query: string,
    provider: EmbeddingProvider
): Promise<{ vector?: Float32Array; degraded: boolean; reasons: string[] }> {
    const stopQueryEmbed = metrics.startTimer("docs.search.embedding_query_ms");
    try {
        const queryInput = applyEmbeddingPrefix([query], "query", provider.model);
        const [vector] = await provider.embed(queryInput);
        if (vector && provider.dims === 0) {
            provider.dims = vector.length;
        }
        return vector ? { vector, degraded: false, reasons: [] } : { degraded: true, reasons: ["vector_disabled"] };
    } catch (err: any) {
        if (err instanceof EmbeddingTimeoutError) {
            return { degraded: true, reasons: ["embedding_timeout"] };
        }
        return { degraded: true, reasons: ["vector_disabled"] };
    } finally {
        stopQueryEmbed();
    }
}

export async function collectAnnChunks(
    queryVector: Float32Array,
    provider: { provider: string; model: string },
    options: { scope: "docs" | "project" | "all"; includeComments: boolean; includeLogs: boolean; includeMetrics: boolean; maxCandidates: number },
    chunkRepository: DocumentChunkRepository,
    vectorIndexManager?: VectorIndexManager
): Promise<{ chunks: StoredDocumentChunk[]; degraded: boolean; reasons: string[] }> {
    if (!vectorIndexManager || !vectorIndexManager.isEnabled()) {
        return { chunks: [], degraded: false, reasons: [] };
    }
    if (provider.model === "hash" || provider.provider === "disabled") {
        return { chunks: [], degraded: false, reasons: [] };
    }
    const result = await vectorIndexManager.search(queryVector, {
        provider: provider.provider,
        model: provider.model,
        k: options.maxCandidates
    });
    if (result.ids.length === 0) {
        return {
            chunks: [],
            degraded: result.degraded,
            reasons: result.reason ? [result.reason] : []
        };
    }
    const chunks: StoredDocumentChunk[] = [];
    for (const id of result.ids) {
        const chunk = chunkRepository.getChunkById(id);
        if (!chunk) continue;
        if (!matchesDocScope(chunk.filePath, options.scope, options.includeComments, options.includeLogs, options.includeMetrics)) {
            continue;
        }
        chunks.push(chunk);
    }
    return {
        chunks,
        degraded: result.degraded,
        reasons: result.reason ? [result.reason] : []
    };
}

export async function resolveEmbeddingProvider(
    embeddingFactory: EmbeddingProviderFactory,
    override?: EmbeddingConfig
): Promise<EmbeddingProvider> {
    if (!override) {
        return embeddingFactory.getProvider();
    }
    const merged = mergeEmbeddingConfig(embeddingFactory.getConfig(), override);
    const factory = new EmbeddingProviderFactory(merged);
    return factory.getProvider();
}
