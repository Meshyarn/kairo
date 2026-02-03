import type { StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";

export const isTestEnv = (): boolean => {
    return process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
};

export const clampDocLimit = (value: number, envKey: string): number => {
    const raw = process.env[envKey];
    if (!raw) return value;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return value;
    return Math.max(1, Math.min(value, Math.floor(parsed)));
};

export const uniqueCandidateFiles = (chunks: StoredDocumentChunk[]): string[] => {
    return Array.from(new Set(chunks.map(chunk => chunk.filePath)));
};

export const limitCandidateFiles = (
    chunks: StoredDocumentChunk[],
    lexicalRankedIds: string[],
    bm25ScoreMap: Map<string, number>,
    maxCandidates: number
): { chunks: StoredDocumentChunk[]; lexicalRankedIds: string[]; bm25ScoreMap: Map<string, number>; candidateFiles: string[]; trimmed: boolean } => {
    const candidateFiles = uniqueCandidateFiles(chunks);
    if (candidateFiles.length <= maxCandidates) {
        return { chunks, lexicalRankedIds, bm25ScoreMap, candidateFiles, trimmed: false };
    }
    const chunkById = new Map(chunks.map(chunk => [chunk.id, chunk]));
    const orderedFiles: string[] = [];
    const seen = new Set<string>();
    for (const chunkId of lexicalRankedIds) {
        const chunk = chunkById.get(chunkId);
        if (!chunk) continue;
        const filePath = chunk.filePath;
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        orderedFiles.push(filePath);
        if (orderedFiles.length >= maxCandidates) break;
    }
    if (orderedFiles.length === 0) {
        return { chunks: [], lexicalRankedIds: [], bm25ScoreMap: new Map(), candidateFiles: [], trimmed: true };
    }
    const allowed = new Set(orderedFiles);
    const filteredChunks = chunks.filter(chunk => allowed.has(chunk.filePath));
    const filteredRankedIds = lexicalRankedIds.filter(id => allowed.has(chunkById.get(id)?.filePath ?? ""));
    const filteredScores = new Map(
        Array.from(bm25ScoreMap.entries()).filter(([id]) => allowed.has(chunkById.get(id)?.filePath ?? ""))
    );
    return {
        chunks: filteredChunks,
        lexicalRankedIds: filteredRankedIds,
        bm25ScoreMap: filteredScores,
        candidateFiles: uniqueCandidateFiles(filteredChunks),
        trimmed: true
    };
};
