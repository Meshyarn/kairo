import * as path from "path";
import { SearchEngine } from "../../engine/Search.js";
import { DocumentChunkRepository, StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";
import { DocumentIndexer } from "../../indexing/DocumentIndexer.js";
import { buildDocScopeGlobs, matchesDocScope, isCodeFile } from "./SearchFilters.js";

interface CandidateFileOptions {
    query: string;
    maxCandidates: number;
    includeComments: boolean;
    scope: "docs" | "project" | "all";
    includeLogs: boolean;
    includeMetrics: boolean;
}

export async function collectCandidateFiles(
    searchEngine: SearchEngine,
    chunkRepository: DocumentChunkRepository,
    options: CandidateFileOptions
): Promise<string[]> {
    const includeGlobs = buildDocScopeGlobs(
        options.scope,
        options.includeComments,
        options.includeLogs,
        options.includeMetrics
    );

    const scoutResults = await searchEngine.scout({
        query: options.query,
        includeGlobs,
        maxResults: options.maxCandidates,
        groupByFile: true,
        deduplicateByContent: true
    });

    const paths = scoutResults
        .map(result => result.filePath)
        .filter(Boolean)
        .filter((filePath) =>
            matchesDocScope(
                filePath,
                options.scope,
                options.includeComments,
                options.includeLogs,
                options.includeMetrics
            )
        );
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const candidate of paths) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        unique.push(candidate);
    }
    if (unique.length > options.maxCandidates) {
        return unique.slice(0, options.maxCandidates);
    }
    if (unique.length < options.maxCandidates) {
        const fallbackLimit = resolveFallbackLimit(options.maxCandidates);
        const extras = chunkRepository.listDocumentFiles(Math.min(options.maxCandidates * 2, fallbackLimit));
        for (const extra of extras) {
            if (seen.has(extra)) continue;
            if (!matchesDocScope(extra, options.scope, options.includeComments, options.includeLogs, options.includeMetrics)) continue;
            seen.add(extra);
            unique.push(extra);
            if (unique.length >= options.maxCandidates) break;
        }
    }
    if (unique.length > 0) return unique;

    const filenameFallback = await searchEngine.searchFilenames(options.query, { maxResults: options.maxCandidates });
    return Array.from(
        new Set(
            filenameFallback
                .map(result => result.path)
                .filter((filePath) =>
                    matchesDocScope(
                        filePath,
                        options.scope,
                        options.includeComments,
                        options.includeLogs,
                        options.includeMetrics
                    )
                )
        )
    );
}

interface CollectChunksOptions {
    filePaths: string[];
    includeComments: boolean;
    rootPath: string;
    documentIndexer: DocumentIndexer;
    chunkRepository: DocumentChunkRepository;
    symbolIndex?: { getSymbolsForFile(filePath: string): Promise<unknown> };
}

export async function collectChunks(options: CollectChunksOptions): Promise<StoredDocumentChunk[]> {
    const chunks: StoredDocumentChunk[] = [];
    const queue = [...options.filePaths];
    const concurrency = resolveChunkConcurrency();

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
            const filePath = queue.shift();
            if (!filePath) break;
            let stored = options.chunkRepository.listChunksForFile(filePath);
            if (stored.length === 0) {
                try {
                    if (options.includeComments && options.symbolIndex && isCodeFile(filePath)) {
                        const abs = path.resolve(options.rootPath, filePath);
                        await options.symbolIndex.getSymbolsForFile(abs);
                    } else {
                        await options.documentIndexer.indexFile(filePath);
                    }
                    stored = options.chunkRepository.listChunksForFile(filePath);
                } catch {
                    stored = [];
                }
            }
            if (stored.length > 0) {
                chunks.push(...stored);
            }
        }
    });

    await Promise.all(workers);
    return chunks;
}

function resolveChunkConcurrency(): number {
    const raw = Number(process.env.KAIRO_DOC_INDEX_CONCURRENCY ?? "");
    const candidate = Number.isFinite(raw) && raw > 0 ? raw : 4;
    return Math.max(1, Math.min(16, Math.floor(candidate)));
}

function resolveFallbackLimit(maxCandidates: number): number {
    const raw = Number(process.env.KAIRO_DOC_FALLBACK_MAX_FILES ?? "");
    const candidate = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 800;
    return Math.max(maxCandidates, candidate);
}
