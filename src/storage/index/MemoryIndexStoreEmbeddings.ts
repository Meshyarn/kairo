import { embeddingKey } from "./IndexCache.js";
import type { EmbeddingKey, StoredEmbedding } from "./IndexTypes.js";

type EmbeddingStoreState = {
    normalize: (value: string) => string;
    chunkIndex: Map<string, { filePath: string; contentHash: string }>;
    embeddings: Map<string, Map<string, StoredEmbedding>>;
};

export const upsertEmbedding = (
    store: EmbeddingStoreState,
    chunkId: string,
    key: EmbeddingKey,
    embedding: { dims: number; vector: Float32Array; norm?: number }
): void => {
    const mapKey = embeddingKey(key);
    const entry: StoredEmbedding = {
        chunkId,
        provider: key.provider,
        model: key.model,
        dims: embedding.dims,
        vector: embedding.vector,
        norm: embedding.norm
    };
    if (!store.embeddings.has(chunkId)) {
        store.embeddings.set(chunkId, new Map());
    }
    store.embeddings.get(chunkId)!.set(mapKey, entry);
};

export const getEmbedding = (store: EmbeddingStoreState, chunkId: string, key: EmbeddingKey): StoredEmbedding | null => {
    const mapKey = embeddingKey(key);
    const entry = store.embeddings.get(chunkId)?.get(mapKey);
    if (!entry) return null;
    return {
        ...entry,
        vector: new Float32Array(entry.vector)
    };
};

export const deleteEmbedding = (store: EmbeddingStoreState, chunkId: string): void => {
    store.embeddings.delete(chunkId);
};

export const deleteEmbeddingsForFile = (store: EmbeddingStoreState, filePath: string): void => {
    const normalized = store.normalize(filePath);
    for (const [chunkId, meta] of store.chunkIndex.entries()) {
        if (meta.filePath === normalized) {
            store.embeddings.delete(chunkId);
        }
    }
};

export const listEmbeddings = (store: EmbeddingStoreState, key: EmbeddingKey, limit?: number): StoredEmbedding[] => {
    const mapKey = embeddingKey(key);
    const max = Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : undefined;
    const results: StoredEmbedding[] = [];
    for (const [chunkId, variants] of store.embeddings.entries()) {
        const entry = variants.get(mapKey);
        if (!entry) continue;
        results.push({
            ...entry,
            vector: new Float32Array(entry.vector)
        });
        if (max && results.length >= max) break;
    }
    return results;
};

export const iterateEmbeddings = (
    store: EmbeddingStoreState,
    key: EmbeddingKey,
    visitor: (embedding: StoredEmbedding) => void,
    options?: { limit?: number }
): void => {
    const mapKey = embeddingKey(key);
    const max = Number.isFinite(options?.limit) && (options?.limit as number) > 0 ? Math.floor(options?.limit as number) : undefined;
    let count = 0;
    for (const variants of store.embeddings.values()) {
        const entry = variants.get(mapKey);
        if (!entry) continue;
        visitor({
            ...entry,
            vector: new Float32Array(entry.vector)
        });
        count++;
        if (max && count >= max) break;
    }
};
