import type { StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";
import { quickMatchScore, tokenize } from "./ResultRanking.js";

export const trimLexicalChunks = (args: {
    chunks: StoredDocumentChunk[];
    normalizedQuery: string;
    maxChunkCandidates: number;
}): StoredDocumentChunk[] => {
    const queryTokens = tokenize(args.normalizedQuery);
    return args.chunks
        .map(chunk => ({
            chunk,
            score: quickMatchScore(chunk.text, queryTokens)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, args.maxChunkCandidates)
        .map(entry => entry.chunk);
};

export const buildRrfScores = (args: {
    bm25RankMap: Map<string, number>;
    vectorRankMap: Map<string, number>;
    rrfDepth: number;
    rrfK: number;
}): Map<string, number> => {
    const rrfScores = new Map<string, number>();
    for (const [docId, rank] of args.bm25RankMap) {
        if (rank > args.rrfDepth) continue;
        rrfScores.set(docId, (rrfScores.get(docId) ?? 0) + 1 / (args.rrfK + rank));
    }
    for (const [docId, rank] of args.vectorRankMap) {
        if (rank > args.rrfDepth) continue;
        rrfScores.set(docId, (rrfScores.get(docId) ?? 0) + 1 / (args.rrfK + rank));
    }
    return rrfScores;
};
