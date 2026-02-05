import type { StoredDocumentChunk } from "./IndexTypes.js";

type DocumentStoreState = {
    normalize: (value: string) => string;
    documentChunks: Map<string, StoredDocumentChunk[]>;
    chunkIndex: Map<string, { filePath: string; contentHash: string }>;
    documentMeta: Map<string, { sourceFormat: string; extractor?: string; warnings?: string[]; reasons?: string[]; stats?: Record<string, unknown>; updatedAt: number }>;
    evidencePacks: Map<string, unknown>;
    chunkSummaries: Map<string, Map<string, { summary: string; contentHash?: string }>>;
};

export const upsertDocumentChunks = (
    store: DocumentStoreState,
    filePath: string,
    chunks: StoredDocumentChunk[]
): void => {
    const normalized = store.normalize(filePath);
    const copy = chunks.map(chunk => ({ ...chunk, filePath: normalized }));
    const previous = store.documentChunks.get(normalized) ?? [];
    for (const chunk of previous) {
        store.chunkIndex.delete(chunk.id);
    }
    store.documentChunks.set(normalized, copy);
    for (const chunk of copy) {
        store.chunkIndex.set(chunk.id, { filePath: normalized, contentHash: chunk.contentHash });
    }
};

export const listDocumentChunks = (store: DocumentStoreState, filePath: string): StoredDocumentChunk[] => {
    const normalized = store.normalize(filePath);
    const chunks = store.documentChunks.get(normalized) ?? [];
    return chunks
        .slice()
        .sort((a, b) => a.range.startLine - b.range.startLine)
        .map(chunk => ({ ...chunk, sectionPath: [...(chunk.sectionPath ?? [])] }));
};

export const listDocumentFiles = (store: DocumentStoreState, limit: number = 500): string[] => {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 500;
    const fast = process.env.KAIRO_DOC_LIST_FAST === "true";
    if (fast) {
        const results: string[] = [];
        for (const key of store.documentChunks.keys()) {
            results.push(key);
            if (results.length >= safeLimit) break;
        }
        return results;
    }
    return Array.from(store.documentChunks.keys()).sort().slice(0, safeLimit);
};

export const getChunkContentHash = (store: DocumentStoreState, chunkId: string): string | undefined => {
    return store.chunkIndex.get(chunkId)?.contentHash;
};

export const getDocumentChunk = (store: DocumentStoreState, chunkId: string): StoredDocumentChunk | null => {
    const meta = store.chunkIndex.get(chunkId);
    if (!meta) return null;
    const chunks = store.documentChunks.get(meta.filePath) ?? [];
    const found = chunks.find(chunk => chunk.id === chunkId);
    return found ? { ...found, sectionPath: [...(found.sectionPath ?? [])] } : null;
};

export const deleteDocumentChunks = (store: DocumentStoreState, filePath: string): void => {
    const normalized = store.normalize(filePath);
    const chunks = store.documentChunks.get(normalized) ?? [];
    for (const chunk of chunks) {
        store.chunkIndex.delete(chunk.id);
    }
    store.documentChunks.delete(normalized);
};

export const upsertDocumentMeta = (
    store: DocumentStoreState,
    filePath: string,
    meta: { filePath: string; sourceFormat: string; extractor?: string; warnings?: string[]; reasons?: string[]; stats?: Record<string, unknown>; updatedAt: number }
): void => {
    const normalized = store.normalize(filePath);
    store.documentMeta.set(normalized, {
        sourceFormat: meta.sourceFormat,
        extractor: meta.extractor,
        warnings: meta.warnings ? [...meta.warnings] : undefined,
        reasons: meta.reasons ? [...meta.reasons] : undefined,
        stats: meta.stats ? { ...meta.stats } : undefined,
        updatedAt: meta.updatedAt
    });
};

export const getDocumentMeta = (
    store: DocumentStoreState,
    filePath: string
): { filePath: string; sourceFormat: string; extractor?: string; warnings?: string[]; reasons?: string[]; stats?: Record<string, unknown>; updatedAt: number } | null => {
    const normalized = store.normalize(filePath);
    const stored = store.documentMeta.get(normalized);
    if (!stored) return null;
    return {
        filePath: normalized,
        sourceFormat: stored.sourceFormat,
        extractor: stored.extractor,
        warnings: stored.warnings ? [...stored.warnings] : undefined,
        reasons: stored.reasons ? [...stored.reasons] : undefined,
        stats: stored.stats ? { ...stored.stats } : undefined,
        updatedAt: stored.updatedAt
    };
};

export const upsertEvidencePack = (store: DocumentStoreState, packId: string, payload: unknown): void => {
    store.evidencePacks.set(packId, payload);
};

export const getEvidencePack = (store: DocumentStoreState, packId: string): unknown | null => {
    return store.evidencePacks.get(packId) ?? null;
};

export const deleteEvidencePack = (store: DocumentStoreState, packId: string): void => {
    store.evidencePacks.delete(packId);
};

export const iterateEvidencePacks = (store: DocumentStoreState, visitor: (packId: string, payload: unknown) => void): void => {
    for (const [packId, payload] of store.evidencePacks.entries()) {
        visitor(packId, payload);
    }
};

export const compactEvidencePacks = (): void => {
    // No-op for in-memory store.
};

export const getChunkSummary = (
    store: DocumentStoreState,
    chunkId: string,
    style: "preview" | "summary"
): { summary: string; contentHash?: string } | null => {
    const entry = store.chunkSummaries.get(chunkId)?.get(style);
    if (!entry) return null;
    return { ...entry };
};

export const upsertChunkSummary = (
    store: DocumentStoreState,
    chunkId: string,
    style: "preview" | "summary",
    summary: string,
    contentHash?: string
): void => {
    if (!store.chunkSummaries.has(chunkId)) {
        store.chunkSummaries.set(chunkId, new Map());
    }
    store.chunkSummaries.get(chunkId)!.set(style, { summary, contentHash });
};

export const deleteChunkSummary = (
    store: DocumentStoreState,
    chunkId: string,
    style: "preview" | "summary"
): void => {
    const styles = store.chunkSummaries.get(chunkId);
    if (!styles) return;
    styles.delete(style);
    if (styles.size === 0) {
        store.chunkSummaries.delete(chunkId);
    }
};

export const deleteChunkSummaries = (store: DocumentStoreState, chunkId: string): void => {
    store.chunkSummaries.delete(chunkId);
};

export const iterateChunkSummaries = (
    store: DocumentStoreState,
    visitor: (chunkId: string, styles: Record<"preview" | "summary", { summary: string; contentHash?: string }>) => void
): void => {
    for (const [chunkId, styles] of store.chunkSummaries.entries()) {
        const payload: Record<"preview" | "summary", { summary: string; contentHash?: string }> = {} as any;
        for (const [style, value] of styles.entries()) {
            if (style !== "preview" && style !== "summary") continue;
            payload[style as "preview" | "summary"] = { ...value };
        }
        visitor(chunkId, payload);
    }
};

export const compactChunkSummaries = (): void => {
    // No-op for in-memory store.
};
