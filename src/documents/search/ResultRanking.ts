import type { StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";

export function buildRankMap(ids: string[]): Map<string, number> {
    const map = new Map<string, number>();
    ids.forEach((id, idx) => map.set(id, idx + 1));
    return map;
}

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(token => token.length > 0);
}

export function quickMatchScore(text: string, tokens: string[]): number {
    if (tokens.length === 0) return 0;
    const haystack = text.toLowerCase();
    let score = 0;
    for (const token of tokens) {
        if (token && haystack.includes(token)) score += 1;
    }
    return score;
}

export function applyMmr<T extends { chunk: StoredDocumentChunk; scores: { final: number } }>(
    candidates: T[],
    lambda: number,
    maxResults: number,
    similarityFn: (aId: string, bId: string) => number
): T[] {
    const selected: T[] = [];
    const remaining = [...candidates];

    while (selected.length < maxResults && remaining.length > 0) {
        let bestIndex = 0;
        let bestScore = -Infinity;

        for (let i = 0; i < remaining.length; i += 1) {
            const candidate = remaining[i];
            const rel = candidate.scores.final;
            let maxSim = 0;
            for (const chosen of selected) {
                const sim = similarityFn(candidate.chunk.id, chosen.chunk.id);
                if (sim > maxSim) maxSim = sim;
            }
            const score = lambda * rel - (1 - lambda) * maxSim;
            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        selected.push(remaining.splice(bestIndex, 1)[0]);
    }

    return selected.concat(remaining);
}

export function computeSimilarity(
    aId: string,
    bId: string,
    vectorCache: Map<string, Float32Array> | null,
    tokenCache: Map<string, Set<string>>
): number {
    const vectorA = vectorCache?.get(aId);
    const vectorB = vectorCache?.get(bId);
    if (vectorA && vectorB) {
        return cosineSimilarity(vectorA, vectorB);
    }
    const tokensA = tokenCache.get(aId);
    const tokensB = tokenCache.get(bId);
    if (!tokensA || !tokensB) return 0;
    return jaccard(tokensA, tokensB);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const item of a) {
        if (b.has(item)) intersection += 1;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length === 0 || b.length === 0) return 0;
    const length = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < length; i += 1) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function l2Norm(vector: Float32Array): number {
    let sum = 0;
    for (const v of vector) {
        sum += v * v;
    }
    return Math.sqrt(sum);
}
