import type { DocumentKind, SymbolInfo, LOD_LEVEL } from "../../types.js";

export type StorageMode = "memory" | "file";

export interface FileRecord {
    path: string;
    last_modified: number;
    language?: string | null;
    size_bytes?: number;
    content_hash?: string;

    /** Current LOD level (0-3). Defaults to 0 (Registry) */
    currentLOD?: LOD_LEVEL;

    /** Timestamp of last LOD promotion */
    lodUpdatedAt?: number;

    /** Topology data if at LOD 1+ */
    topology?: {
        imports: string[];      // Simplified: just module paths
        exports: string[];      // Simplified: just exported names
        dependencies: string[]; // Resolved file paths
    };
}

export interface StoredDependency {
    source: string;
    target: string;
    type: string;
    weight: number;
    metadata?: Record<string, unknown>;
}

export interface StoredUnresolvedDependency {
    specifier: string;
    error?: string;
    metadata?: Record<string, unknown>;
}

export interface StoredGhostSymbol {
    name: string;
    lastSeenPath: string;
    type: string;
    lastKnownSignature?: string | null;
    deletedAt: number;
}

export interface StoredDocumentChunk {
    id: string;
    filePath: string;
    kind: DocumentKind;
    sectionPath: string[];
    heading: string | null;
    headingLevel: number | null;
    range: { startLine: number; endLine: number; startByte: number; endByte: number };
    text: string;
    contentHash: string;
    updatedAt: number;
}

export interface StoredEmbedding {
    chunkId: string;
    provider: string;
    model: string;
    dims: number;
    vector: Float32Array;
    norm?: number;
}

export type EmbeddingKey = { provider: string; model: string };

export interface TransactionLogEntry {
    id: string;
    timestamp: number;
    status: "pending" | "committed" | "rolled_back";
    description: string;
    snapshots: Array<{
        filePath: string;
        originalContent: string;
        originalHash: string;
        newContent?: string;
        newHash?: string;
    }>;
}

export interface IndexStore {
    mode: StorageMode;

    getOrCreateFile(relativePath: string, lastModified?: number, language?: string | null): FileRecord;
    getFile(relativePath: string): FileRecord | undefined;
    listFiles(): FileRecord[];
    deleteFile(relativePath: string): void;
    deleteFilesByPrefix(prefix: string): void;

    replaceSymbols(args: { relativePath: string; lastModified: number; language?: string | null; symbols: SymbolInfo[] }): void;
    readSymbols(relativePath: string): SymbolInfo[] | undefined;
    streamAllSymbols(): Map<string, SymbolInfo[]>;
    searchSymbols(pattern: string, limit?: number): Array<{ path: string; data_json: string }>;

    replaceDependencies(args: {
        relativePath: string;
        lastModified: number;
        outgoing: Array<{ targetPath?: string; type: string; weight?: number; metadata?: Record<string, unknown> }>;
        unresolved: StoredUnresolvedDependency[];
    }): void;
    getDependencies(relativePath: string, direction: "incoming" | "outgoing"): StoredDependency[];
    countDependencies(relativePath: string, direction: "incoming" | "outgoing"): number;
    listUnresolved(): { filePath: string; specifier: string; error?: string; metadata?: Record<string, unknown> }[];
    listUnresolvedForFile(relativePath: string): { specifier: string; error?: string; metadata?: Record<string, unknown> }[];
    clearDependencies(relativePath: string): void;

    addGhost(ghost: StoredGhostSymbol): void;
    findGhost(name: string): StoredGhostSymbol | undefined;
    listGhosts(): StoredGhostSymbol[];
    deleteGhost(name: string): void;
    pruneGhosts(olderThanMs: number): void;

    upsertDocumentChunks(filePath: string, chunks: StoredDocumentChunk[]): void;
    listDocumentChunks(filePath: string): StoredDocumentChunk[];
    listDocumentFiles(limit?: number): string[];
    getChunkContentHash(chunkId: string): string | undefined;
    getDocumentChunk(chunkId: string): StoredDocumentChunk | null;
    deleteDocumentChunks(filePath: string): void;

    upsertEmbedding(chunkId: string, key: EmbeddingKey, embedding: { dims: number; vector: Float32Array; norm?: number }): void;
    getEmbedding(chunkId: string, key: EmbeddingKey): StoredEmbedding | null;
    deleteEmbedding(chunkId: string): void;
    deleteEmbeddingsForFile(filePath: string): void;
    listEmbeddings(key: EmbeddingKey, limit?: number): StoredEmbedding[];
    iterateEmbeddings(key: EmbeddingKey, visitor: (embedding: StoredEmbedding) => void, options?: { limit?: number }): void;

    upsertEvidencePack(packId: string, payload: unknown): void;
    getEvidencePack(packId: string): unknown | null;
    deleteEvidencePack(packId: string): void;
    iterateEvidencePacks(visitor: (packId: string, payload: unknown) => void): void;
    compactEvidencePacks(): void;

    getChunkSummary(chunkId: string, style: "preview" | "summary"): { summary: string; contentHash?: string } | null;
    upsertChunkSummary(chunkId: string, style: "preview" | "summary", summary: string, contentHash?: string): void;
    deleteChunkSummary(chunkId: string, style: "preview" | "summary"): void;
    deleteChunkSummaries(chunkId: string): void;
    iterateChunkSummaries(visitor: (chunkId: string, styles: Record<"preview" | "summary", { summary: string; contentHash?: string }>) => void): void;
    compactChunkSummaries(): void;

    upsertPendingTransaction(entry: TransactionLogEntry): void;
    listPendingTransactions(): TransactionLogEntry[];
    markTransactionCommitted(id: string, entry: TransactionLogEntry): void;
    markTransactionRolledBack(id: string): void;

    close(): void;
    dispose(): void;
}

export type DependencySnapshot = { outgoing: StoredDependency[]; unresolved: StoredUnresolvedDependency[] };

export type PersistedEmbedding = {
    provider: string;
    model: string;
    dims: number;
    vector: string;
    norm?: number;
};

export type PersistedTransaction = TransactionLogEntry;
