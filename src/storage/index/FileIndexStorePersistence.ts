import * as fs from "fs";
import * as path from "path";
import type { SymbolInfo } from "../../types.js";
import { decodeVector, encodeVector } from "./IndexCache.js";
import { readJson } from "./IndexReader.js";
import { writeJson } from "./IndexWriter.js";
import type {
    DependencySnapshot,
    FileRecord,
    PersistedEmbedding,
    PersistedTransaction,
    StoredDocumentChunk,
    StoredGhostSymbol
} from "./IndexTypes.js";

type FileIndexStoreState = {
    storageDir: string;
    manifestPath: string;
    filesPath: string;
    symbolsPath: string;
    secondaryIndexPath: string;
    dependenciesPath: string;
    ghostsPath: string;
    chunksPath: string;
    documentMetaPath: string;
    embeddingsPath: string;
    packsPath: string;
    summariesPath: string;
    transactionsPath: string;
    embeddingPackConfig: { enabled: boolean };
    hasEmbeddingPackOnDisk: boolean;
    embeddingPacks: Map<string, { flush: () => void }>;
    files: Map<string, FileRecord>;
    symbols: Map<string, SymbolInfo[]>;
    symbolRefsByTrigram: Map<string, Set<string>>;
    symbolSecondaryIndexEnabled: boolean;
    symbolSecondaryIndexBytes: number;
    dependencies: Map<string, DependencySnapshot>;
    ghosts: Map<string, StoredGhostSymbol>;
    documentChunks: Map<string, StoredDocumentChunk[]>;
    documentMeta: Map<string, { sourceFormat: string; extractor?: string; warnings?: string[]; reasons?: string[]; stats?: Record<string, unknown>; updatedAt: number }>;
    embeddings: Map<string, Map<string, { provider: string; model: string; dims: number; vector: Float32Array; norm?: number }>>;
    evidencePacks: Map<string, unknown>;
    chunkSummaries: Map<string, Map<string, { summary: string; contentHash?: string }>>;
    transactions: Map<string, PersistedTransaction>;
    getFile: (filePath: string) => FileRecord | undefined;
    normalize: (filePath: string) => string;
    getOrCreateFile: (relativePath: string, lastModified?: number, language?: string | null) => void;
    addGhost: (ghost: StoredGhostSymbol) => void;
    upsertDocumentChunks: (filePath: string, chunks: StoredDocumentChunk[]) => void;
    upsertDocumentMeta: (filePath: string, meta: any) => void;
    upsertEmbedding: (chunkId: string, key: { provider: string; model: string }, payload: { dims: number; vector: Float32Array; norm?: number }) => void;
    upsertEvidencePack: (packId: string, payload: unknown) => void;
    upsertChunkSummary: (chunkId: string, style: "preview" | "summary", summary: string, contentHash?: string) => void;
    upsertPendingTransaction: (entry: PersistedTransaction) => void;
    listFiles: () => FileRecord[];
    streamAllSymbols: () => Map<string, SymbolInfo[]>;
    listGhosts: () => StoredGhostSymbol[];
    rebuildSecondaryIndex: () => void;
    resolveSecondaryIndexMaxBytes: () => number;
};

export const ensureStorage = (store: FileIndexStoreState): void => {
    fs.mkdirSync(store.storageDir, { recursive: true });
    if (!fs.existsSync(store.manifestPath)) {
        writeJson(store.manifestPath, { version: 0, createdAt: new Date().toISOString() });
    }
};

export const loadFromDisk = (store: FileIndexStoreState): void => {
    const files = readJson<FileRecord[]>(store.filesPath, []);
    for (const record of files) {
        if (record?.path) {
            store.files.set(record.path, { ...record });
        }
    }

    const symbols = readJson<Record<string, SymbolInfo[]>>(store.symbolsPath, {});
    for (const [filePath, entries] of Object.entries(symbols)) {
        const record = store.getFile(filePath);
        store.getOrCreateFile(filePath, record?.last_modified ?? Date.now(), record?.language ?? null);
        store.symbols.set(store.normalize(filePath), entries ?? []);
    }

    const deps = readJson<Record<string, DependencySnapshot>>(store.dependenciesPath, {});
    for (const [filePath, snapshot] of Object.entries(deps)) {
        store.dependencies.set(filePath, {
            outgoing: snapshot.outgoing ?? [],
            unresolved: snapshot.unresolved ?? []
        });
    }

    const ghosts = readJson<StoredGhostSymbol[]>(store.ghostsPath, []);
    for (const ghost of ghosts) {
        if (ghost?.name) {
            store.addGhost(ghost);
        }
    }

    const chunks = readJson<Record<string, StoredDocumentChunk[]>>(store.chunksPath, {});
    for (const [filePath, entries] of Object.entries(chunks)) {
        store.upsertDocumentChunks(filePath, entries ?? []);
    }

    const metas = readJson<Record<string, any>>(store.documentMetaPath, {});
    for (const [filePath, meta] of Object.entries(metas)) {
        if (!meta || typeof meta !== "object") continue;
        if (typeof (meta as any).sourceFormat !== "string") continue;
        store.upsertDocumentMeta(filePath, {
            filePath,
            sourceFormat: String((meta as any).sourceFormat),
            extractor: typeof (meta as any).extractor === "string" ? (meta as any).extractor : undefined,
            warnings: Array.isArray((meta as any).warnings) ? (meta as any).warnings.map((v: any) => String(v)) : undefined,
            reasons: Array.isArray((meta as any).reasons) ? (meta as any).reasons.map((v: any) => String(v)) : undefined,
            stats: (meta as any).stats && typeof (meta as any).stats === "object" ? (meta as any).stats : undefined,
            updatedAt: Number.isFinite((meta as any).updatedAt) ? (meta as any).updatedAt : Date.now()
        });
    }

    if (!store.embeddingPackConfig.enabled || !store.hasEmbeddingPackOnDisk) {
        const embeddings = readJson<Record<string, Record<string, PersistedEmbedding>>>(store.embeddingsPath, {});
        for (const [chunkId, variants] of Object.entries(embeddings)) {
            for (const [variantKey, payload] of Object.entries(variants ?? {})) {
                if (!payload?.vector) continue;
                const vector = decodeVector(payload.vector);
                const [provider, model] = variantKey.split("::", 2);
                if (!provider || !model) continue;
                store.upsertEmbedding(chunkId, { provider, model }, {
                    dims: payload.dims,
                    vector,
                    norm: payload.norm
                });
            }
        }
    }

    const packs = readJson<Record<string, unknown>>(store.packsPath, {});
    for (const [packId, payload] of Object.entries(packs)) {
        store.upsertEvidencePack(packId, payload);
    }

    const summaries = readJson<Record<string, Record<string, { summary: string; contentHash?: string }>>>(store.summariesPath, {});
    for (const [chunkId, styles] of Object.entries(summaries)) {
        for (const [style, payload] of Object.entries(styles ?? {})) {
            if (style !== "preview" && style !== "summary") continue;
            if (!payload?.summary) continue;
            store.upsertChunkSummary(chunkId, style as "preview" | "summary", payload.summary, payload.contentHash);
        }
    }

    const transactions = readJson<Record<string, PersistedTransaction>>(store.transactionsPath, {});
    for (const entry of Object.values(transactions)) {
        if (entry?.id) {
            store.upsertPendingTransaction(entry);
        }
    }
};

export const loadSecondaryIndex = (store: FileIndexStoreState): void => {
    if (!store.symbolSecondaryIndexEnabled) {
        store.symbolRefsByTrigram.clear();
        store.symbolSecondaryIndexBytes = 0;
        return;
    }
    const maxBytes = store.resolveSecondaryIndexMaxBytes();
    if (!fs.existsSync(store.secondaryIndexPath)) {
        store.rebuildSecondaryIndex();
        persistSecondaryIndex(store);
        return;
    }
    try {
        const size = fs.statSync(store.secondaryIndexPath).size;
        store.symbolSecondaryIndexBytes = size;
        if (maxBytes > 0 && size > maxBytes) {
            store.symbolSecondaryIndexEnabled = false;
            store.symbolRefsByTrigram.clear();
            fs.rmSync(store.secondaryIndexPath, { force: true });
            return;
        }
    } catch {
        // best-effort
    }
    const payload = readJson<{ version?: number; trigrams?: Record<string, string[]> } | null>(store.secondaryIndexPath, null);
    if (!payload || payload.version !== 1 || !payload.trigrams || typeof payload.trigrams !== "object") {
        store.rebuildSecondaryIndex();
        persistSecondaryIndex(store);
        return;
    }
    store.symbolRefsByTrigram.clear();
    for (const [trigram, refs] of Object.entries(payload.trigrams)) {
        if (!Array.isArray(refs) || refs.length === 0) continue;
        store.symbolRefsByTrigram.set(trigram, new Set(refs.filter(Boolean)));
    }
    if (!Number.isFinite(store.symbolSecondaryIndexBytes)) {
        store.symbolSecondaryIndexBytes = 0;
    }
};

export const persistFiles = (store: FileIndexStoreState): void => {
    writeJson(store.filesPath, store.listFiles());
};

export const persistSymbols = (store: FileIndexStoreState): void => {
    const payload: Record<string, SymbolInfo[]> = {};
    for (const [filePath, entries] of store.streamAllSymbols().entries()) {
        payload[filePath] = entries;
    }
    writeJson(store.symbolsPath, payload);
};

export const persistSecondaryIndex = (store: FileIndexStoreState): void => {
    if (!store.symbolSecondaryIndexEnabled) return;
    if ((store as any).secondaryIndexPersistTimer) return;
    (store as any).secondaryIndexPersistTimer = setTimeout(() => {
        (store as any).secondaryIndexPersistTimer = undefined;
        flushSecondaryIndex(store);
    }, 250);
};

export const flushSecondaryIndex = (store: FileIndexStoreState): void => {
    if (!store.symbolSecondaryIndexEnabled) return;
    const payload = buildSecondaryIndexPayload(store);
    const json = JSON.stringify(payload);
    const size = Buffer.byteLength(json);
    const maxBytes = store.resolveSecondaryIndexMaxBytes();
    if (maxBytes > 0 && size > maxBytes) {
        store.symbolSecondaryIndexEnabled = false;
        store.symbolRefsByTrigram.clear();
        store.symbolSecondaryIndexBytes = size;
        try {
            fs.rmSync(store.secondaryIndexPath, { force: true });
        } catch {
            // best-effort
        }
        return;
    }
    const dir = path.dirname(store.secondaryIndexPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${store.secondaryIndexPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, json);
    fs.renameSync(tmpPath, store.secondaryIndexPath);
    store.symbolSecondaryIndexBytes = size;
};

export const resolveSecondaryIndexMaxBytes = (): number => {
    const raw = Number.parseInt(process.env.KAIRO_SYMBOL_SECONDARY_INDEX_MAX_BYTES ?? "67108864", 10);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw;
};

export const buildSecondaryIndexPayload = (
    store: FileIndexStoreState
): { version: number; trigrams: Record<string, string[]> } => {
    const trigrams: Record<string, string[]> = {};
    for (const [key, refs] of store.symbolRefsByTrigram.entries()) {
        trigrams[key] = Array.from(refs);
    }
    return { version: 1, trigrams };
};

export const persistDependencies = (store: FileIndexStoreState): void => {
    const payload: Record<string, DependencySnapshot> = {};
    for (const [filePath, snapshot] of store.dependencies.entries()) {
        payload[filePath] = snapshot;
    }
    writeJson(store.dependenciesPath, payload);
};

export const persistGhosts = (store: FileIndexStoreState): void => {
    writeJson(store.ghostsPath, store.listGhosts());
};

export const persistChunks = (store: FileIndexStoreState): void => {
    const payload: Record<string, StoredDocumentChunk[]> = {};
    for (const [filePath, chunks] of store.documentChunks.entries()) {
        payload[filePath] = chunks;
    }
    writeJson(store.chunksPath, payload);
};

export const persistDocumentMeta = (store: FileIndexStoreState): void => {
    const payload: Record<string, unknown> = {};
    for (const [filePath, meta] of store.documentMeta.entries()) {
        payload[filePath] = meta;
    }
    writeJson(store.documentMetaPath, payload);
};

export const persistEmbeddings = (store: FileIndexStoreState): void => {
    if (store.embeddingPackConfig.enabled && store.hasEmbeddingPackOnDisk) {
        for (const pack of store.embeddingPacks.values()) {
            pack.flush();
        }
        return;
    }
    const payload: Record<string, Record<string, PersistedEmbedding>> = {};
    for (const [chunkId, variants] of store.embeddings.entries()) {
        payload[chunkId] = {};
        for (const [variantKey, embedding] of variants.entries()) {
            payload[chunkId][variantKey] = {
                provider: embedding.provider,
                model: embedding.model,
                dims: embedding.dims,
                vector: encodeVector(embedding.vector),
                norm: embedding.norm
            };
        }
    }
    writeJson(store.embeddingsPath, payload);
};

export const persistPacks = (store: FileIndexStoreState): void => {
    const payload: Record<string, unknown> = {};
    for (const [packId, value] of store.evidencePacks.entries()) {
        payload[packId] = value;
    }
    writeJson(store.packsPath, payload);
};

export const persistSummaries = (store: FileIndexStoreState): void => {
    const payload: Record<string, Record<string, { summary: string; contentHash?: string }>> = {};
    for (const [chunkId, styles] of store.chunkSummaries.entries()) {
        payload[chunkId] = {};
        for (const [style, value] of styles.entries()) {
            payload[chunkId][style] = value;
        }
    }
    writeJson(store.summariesPath, payload);
};

export const persistTransactions = (store: FileIndexStoreState): void => {
    const payload: Record<string, PersistedTransaction> = {};
    for (const [id, entry] of store.transactions.entries()) {
        payload[id] = entry;
    }
    writeJson(store.transactionsPath, payload);
};
