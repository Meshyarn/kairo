import type { NativeSearchCoreClient } from "../../engine/search/native/NativeSearchCore.js";
import type { DocumentChunkRepository, StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";
import type { DocumentSearchResponse } from "./SearchTypes.js";
import type { IndexDatabase } from "../../indexing/IndexDatabase.js";
import { buildRankMap } from "./ResultRanking.js";
import { matchesDocScope } from "./SearchFilters.js";

export const collectNativeChunks = async (args: {
    nativeSearchCore: NativeSearchCoreClient;
    chunkRepository: DocumentChunkRepository;
    repoId: string;
    query: string;
    options: { maxCandidates: number; scope: "docs" | "project" | "all"; includeComments: boolean; includeLogs: boolean; includeMetrics: boolean };
}): Promise<{ chunks: StoredDocumentChunk[]; scoreMap: Map<string, number>; rankMap: Map<string, number>; rankedIds: string[] }> => {
    const scopes = new Set<"docs" | "comments" | "logs" | "metrics">();
    scopes.add("docs");
    if (args.options.includeComments) scopes.add("comments");
    if (args.options.includeLogs) scopes.add("logs");
    if (args.options.includeMetrics) scopes.add("metrics");

    const hits = args.nativeSearchCore.search({
        kind: "doc_chunk",
        query: args.query,
        limit: args.options.maxCandidates,
        scopes: Array.from(scopes),
        repoIds: [args.repoId]
    });

    const chunks: StoredDocumentChunk[] = [];
    const scoreMap = new Map<string, number>();
    const rankedIds: string[] = [];
    for (const hit of hits) {
        if (!hit.chunkId) continue;
        const chunk = args.chunkRepository.getChunkById(hit.chunkId);
        if (!chunk) continue;
        if (!matchesDocScope(chunk.filePath, args.options.scope, args.options.includeComments, args.options.includeLogs, args.options.includeMetrics)) {
            continue;
        }
        chunks.push(chunk);
        rankedIds.push(chunk.id);
        scoreMap.set(chunk.id, hit.score);
    }
    return { chunks, scoreMap, rankMap: buildRankMap(rankedIds), rankedIds };
};

export const attachFileMeta = (args: {
    response: DocumentSearchResponse;
    indexDatabase?: IndexDatabase;
}): DocumentSearchResponse => {
    if (!args.indexDatabase) return args.response;
    const filePaths = new Set<string>();
    for (const section of args.response.results ?? []) {
        if (section?.filePath) filePaths.add(section.filePath);
    }
    for (const section of args.response.evidence ?? []) {
        if (section?.filePath) filePaths.add(section.filePath);
    }
    if (filePaths.size === 0) return args.response;

    const meta: NonNullable<DocumentSearchResponse["fileMeta"]> = {};
    for (const filePath of filePaths) {
        const entry = args.indexDatabase.getDocumentMeta(filePath);
        if (!entry) continue;
        if (!entry.warnings || entry.warnings.length === 0) continue;
        meta[filePath] = {
            sourceFormat: entry.sourceFormat,
            extractor: entry.extractor,
            warnings: entry.warnings,
            reasons: entry.reasons,
            stats: entry.stats,
            updatedAt: entry.updatedAt
        };
    }

    if (Object.keys(meta).length === 0) return args.response;
    return { ...args.response, fileMeta: meta };
};

export const isPackStale = async (args: {
    items: Array<{ chunkId: string; snapshot?: { contentHash?: string } }>;
    chunkRepository: DocumentChunkRepository;
}): Promise<boolean> => {
    const pairs = args.items
        .map(item => ({ id: item.chunkId, hash: item.snapshot?.contentHash }))
        .filter(p => Boolean(p.id) && Boolean(p.hash)) as Array<{ id: string; hash: string }>;
    if (pairs.length === 0) return false;
    for (const { id, hash } of pairs) {
        try {
            const current = args.chunkRepository.getContentHashByChunkId(id);
            if (current && current !== hash) return true;
        } catch {
            // ignore
        }
    }
    return false;
};
