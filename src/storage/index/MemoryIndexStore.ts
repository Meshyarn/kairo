import * as fs from "fs";
import * as path from "path";
import type { SymbolInfo } from "../../types.js";
import {
    compactChunkSummaries,
    compactEvidencePacks,
    deleteChunkSummaries,
    deleteChunkSummary,
    deleteDocumentChunks,
    deleteEvidencePack,
    getChunkContentHash,
    getChunkSummary,
    getDocumentChunk,
    getDocumentMeta,
    getEvidencePack,
    iterateChunkSummaries,
    iterateEvidencePacks,
    listDocumentChunks,
    listDocumentFiles,
    upsertChunkSummary,
    upsertDocumentChunks,
    upsertDocumentMeta,
    upsertEvidencePack
} from "./MemoryIndexStoreDocuments.js";
import {
    deleteEmbedding,
    deleteEmbeddingsForFile,
    getEmbedding,
    iterateEmbeddings,
    listEmbeddings,
    upsertEmbedding
} from "./MemoryIndexStoreEmbeddings.js";
import {
    addGhost,
    deleteGhost,
    findGhost,
    listGhosts,
    pruneGhosts
} from "./MemoryIndexStoreGhosts.js";
import {
    listPendingTransactions,
    listTransactions,
    markTransactionCommitted,
    markTransactionRolledBack,
    upsertPendingTransaction
} from "./MemoryIndexStoreTransactions.js";
import {
    getSecondaryIndexStatus,
    readSymbols,
    rebuildSecondaryIndex,
    removeSecondaryIndexForFile,
    replaceSymbols,
    searchSymbols,
    streamAllSymbols
} from "./MemoryIndexStoreSymbols.js";
import type {
    DependencySnapshot,
    EmbeddingKey,
    FileRecord,
    IndexStore,
    StoredDependency,
    StoredDocumentChunk,
    StoredEmbedding,
    StoredGhostSymbol,
    StoredUnresolvedDependency,
    StorageMode,
    TransactionLogEntry
} from "./IndexTypes.js";

export class MemoryIndexStore implements IndexStore {
    public readonly mode: StorageMode;
    protected readonly rootPath: string;

    protected readonly files = new Map<string, FileRecord>();
    protected readonly symbols = new Map<string, SymbolInfo[]>();
    protected readonly symbolRefsByTrigram = new Map<string, Set<string>>();
    protected symbolSecondaryIndexEnabled = this.resolveSecondaryIndexEnabled();
    protected symbolSecondaryIndexBytes = 0;
    protected readonly dependencies = new Map<string, DependencySnapshot>();
    protected readonly ghosts = new Map<string, StoredGhostSymbol>();
    protected readonly documentChunks = new Map<string, StoredDocumentChunk[]>();
    protected readonly chunkIndex = new Map<string, { filePath: string; contentHash: string }>();
    protected readonly documentMeta = new Map<string, { sourceFormat: string; extractor?: string; warnings?: string[]; reasons?: string[]; stats?: Record<string, unknown>; updatedAt: number }>();
    protected readonly embeddings = new Map<string, Map<string, StoredEmbedding>>();
    protected readonly evidencePacks = new Map<string, unknown>();
    protected readonly chunkSummaries = new Map<string, Map<string, { summary: string; contentHash?: string }>>();
    protected readonly transactions = new Map<string, TransactionLogEntry>();

    constructor(rootPath: string, mode: StorageMode = "memory") {
        this.rootPath = path.resolve(rootPath);
        this.mode = mode;
    }

    public getOrCreateFile(relativePath: string, lastModified?: number, language?: string | null): FileRecord {
        const normalized = this.normalize(relativePath);
        const existing = this.files.get(normalized);
        if (existing) {
            if (lastModified !== undefined) {
                existing.last_modified = lastModified;
            }
            if (language !== undefined) {
                existing.language = language ?? null;
            }
            return { ...existing };
        }
        const record: FileRecord = {
            path: normalized,
            last_modified: lastModified ?? 0,
            language: language ?? null
        };
        this.files.set(normalized, record);
        return { ...record };
    }

    public getFile(relativePath: string): FileRecord | undefined {
        const normalized = this.normalize(relativePath);
        const record = this.files.get(normalized);
        return record ? { ...record } : undefined;
    }

    public listFiles(): FileRecord[] {
        return Array.from(this.files.values()).map(record => ({ ...record }));
    }

    public updateFileMeta(
        relativePath: string,
        updates: { lastModified?: number; language?: string | null; contentHash?: string; sizeBytes?: number }
    ): FileRecord {
        const normalized = this.normalize(relativePath);
        const record = this.files.get(normalized) ?? {
            path: normalized,
            last_modified: updates.lastModified ?? 0,
            language: updates.language ?? null
        };
        if (updates.lastModified !== undefined) {
            record.last_modified = updates.lastModified;
        }
        if (updates.language !== undefined) {
            record.language = updates.language ?? null;
        }
        if (updates.contentHash !== undefined) {
            record.content_hash = updates.contentHash;
        }
        if (updates.sizeBytes !== undefined) {
            record.size_bytes = updates.sizeBytes;
        }
        this.files.set(normalized, record);
        return { ...record };
    }

    public deleteFile(relativePath: string): void {
        const normalized = this.normalize(relativePath);
        removeSecondaryIndexForFile(this as any, normalized);
        this.files.delete(normalized);
        this.symbols.delete(normalized);
        this.dependencies.delete(normalized);
        this.documentMeta.delete(normalized);
        this.deleteEmbeddingsForFile(normalized);
        this.deleteDocumentChunks(normalized);
        this.cleanupIncomingDependencies(normalized);
    }

    public deleteFilesByPrefix(prefix: string): void {
        const normalizedPrefix = this.normalize(prefix);
        for (const key of Array.from(this.files.keys())) {
            if (key === normalizedPrefix || key.startsWith(`${normalizedPrefix}/`)) {
                this.deleteFile(key);
            }
        }
    }

    public replaceSymbols(args: { relativePath: string; lastModified: number; language?: string | null; symbols: SymbolInfo[] }): void {
        replaceSymbols(this as any, args, (relativePath, lastModified, language) => {
            this.getOrCreateFile(relativePath, lastModified, language);
        });
    }

    public readSymbols(relativePath: string): SymbolInfo[] | undefined {
        return readSymbols(this as any, relativePath);
    }

    public streamAllSymbols(): Map<string, SymbolInfo[]> {
        return streamAllSymbols(this as any);
    }

    public searchSymbols(pattern: string, limit: number = 100): Array<{ path: string; data_json: string }> {
        return searchSymbols(this as any, pattern, limit);
    }

    public getSecondaryIndexStatus(): { enabled: boolean; bytes?: number } {
        return getSecondaryIndexStatus(this as any);
    }

    public replaceDependencies(args: {
        relativePath: string;
        lastModified: number;
        outgoing: Array<{ targetPath?: string; type: string; weight?: number; metadata?: Record<string, unknown> }>;
        unresolved: StoredUnresolvedDependency[];
    }): void {
        const normalized = this.normalize(args.relativePath);
        this.getOrCreateFile(normalized, args.lastModified);
        const outgoing: StoredDependency[] = [];
        for (const dep of args.outgoing) {
            if (!dep.targetPath) continue;
            outgoing.push({
                source: normalized,
                target: this.normalize(dep.targetPath),
                type: dep.type,
                weight: dep.weight ?? 1,
                metadata: dep.metadata
            });
        }
        this.dependencies.set(normalized, {
            outgoing,
            unresolved: args.unresolved ?? []
        });
    }

    public getDependencies(relativePath: string, direction: "incoming" | "outgoing"): StoredDependency[] {
        const normalized = this.normalize(relativePath);
        if (direction === "outgoing") {
            return (this.dependencies.get(normalized)?.outgoing ?? []).map(dep => ({ ...dep }));
        }
        const incoming: StoredDependency[] = [];
        for (const [source, snapshot] of this.dependencies.entries()) {
            for (const dep of snapshot.outgoing) {
                if (dep.target === normalized) {
                    incoming.push({ ...dep, source });
                }
            }
        }
        return incoming;
    }

    public countDependencies(relativePath: string, direction: "incoming" | "outgoing"): number {
        return this.getDependencies(relativePath, direction).length;
    }

    public listUnresolved(): { filePath: string; specifier: string; error?: string; metadata?: Record<string, unknown> }[] {
        const unresolved: { filePath: string; specifier: string; error?: string; metadata?: Record<string, unknown> }[] = [];
        for (const [filePath, snapshot] of this.dependencies.entries()) {
            for (const entry of snapshot.unresolved ?? []) {
                unresolved.push({
                    filePath,
                    specifier: entry.specifier,
                    error: entry.error,
                    metadata: entry.metadata
                });
            }
        }
        return unresolved;
    }

    public listUnresolvedForFile(relativePath: string): { specifier: string; error?: string; metadata?: Record<string, unknown> }[] {
        const normalized = this.normalize(relativePath);
        const entries = this.dependencies.get(normalized)?.unresolved ?? [];
        return entries.map(entry => ({
            specifier: entry.specifier,
            error: entry.error,
            metadata: entry.metadata
        }));
    }

    public clearDependencies(relativePath: string): void {
        const normalized = this.normalize(relativePath);
        const snapshot = this.dependencies.get(normalized);
        if (snapshot) {
            this.dependencies.set(normalized, { outgoing: [], unresolved: [] });
        }
    }

    public addGhost(ghost: StoredGhostSymbol): void {
        addGhost(this as any, ghost);
    }

    public findGhost(name: string): StoredGhostSymbol | undefined {
        return findGhost(this as any, name);
    }

    public listGhosts(): StoredGhostSymbol[] {
        return listGhosts(this as any);
    }

    public deleteGhost(name: string): void {
        deleteGhost(this as any, name);
    }

    public pruneGhosts(olderThanMs: number): void {
        pruneGhosts(this as any, olderThanMs);
    }

    public upsertDocumentChunks(filePath: string, chunks: StoredDocumentChunk[]): void {
        upsertDocumentChunks(this as any, filePath, chunks);
    }

    public listDocumentChunks(filePath: string): StoredDocumentChunk[] {
        return listDocumentChunks(this as any, filePath);
    }

    public listDocumentFiles(limit: number = 500): string[] {
        return listDocumentFiles(this as any, limit);
    }

    public getChunkContentHash(chunkId: string): string | undefined {
        return getChunkContentHash(this as any, chunkId);
    }

    public getDocumentChunk(chunkId: string): StoredDocumentChunk | null {
        return getDocumentChunk(this as any, chunkId);
    }

    public deleteDocumentChunks(filePath: string): void {
        deleteDocumentChunks(this as any, filePath);
    }

    public upsertDocumentMeta(filePath: string, meta: { filePath: string; sourceFormat: string; extractor?: string; warnings?: string[]; reasons?: string[]; stats?: Record<string, unknown>; updatedAt: number }): void {
        upsertDocumentMeta(this as any, filePath, meta);
    }

    public getDocumentMeta(filePath: string): { filePath: string; sourceFormat: string; extractor?: string; warnings?: string[]; reasons?: string[]; stats?: Record<string, unknown>; updatedAt: number } | null {
        return getDocumentMeta(this as any, filePath);
    }

    public upsertEmbedding(chunkId: string, key: EmbeddingKey, embedding: { dims: number; vector: Float32Array; norm?: number }): void {
        upsertEmbedding(this as any, chunkId, key, embedding);
    }

    public getEmbedding(chunkId: string, key: EmbeddingKey): StoredEmbedding | null {
        return getEmbedding(this as any, chunkId, key);
    }

    public deleteEmbedding(chunkId: string): void {
        deleteEmbedding(this as any, chunkId);
    }

    public deleteEmbeddingsForFile(filePath: string): void {
        deleteEmbeddingsForFile(this as any, filePath);
    }

    public listEmbeddings(key: EmbeddingKey, limit?: number): StoredEmbedding[] {
        return listEmbeddings(this as any, key, limit);
    }

    public iterateEmbeddings(key: EmbeddingKey, visitor: (embedding: StoredEmbedding) => void, options?: { limit?: number }): void {
        iterateEmbeddings(this as any, key, visitor, options);
    }

    public upsertEvidencePack(packId: string, payload: unknown): void {
        upsertEvidencePack(this as any, packId, payload);
    }

    public getEvidencePack(packId: string): unknown | null {
        return getEvidencePack(this as any, packId);
    }

    public deleteEvidencePack(packId: string): void {
        deleteEvidencePack(this as any, packId);
    }

    public iterateEvidencePacks(visitor: (packId: string, payload: unknown) => void): void {
        iterateEvidencePacks(this as any, visitor);
    }

    public compactEvidencePacks(): void {
        compactEvidencePacks();
    }

    public getChunkSummary(chunkId: string, style: "preview" | "summary"): { summary: string; contentHash?: string } | null {
        return getChunkSummary(this as any, chunkId, style);
    }

    public upsertChunkSummary(chunkId: string, style: "preview" | "summary", summary: string, contentHash?: string): void {
        upsertChunkSummary(this as any, chunkId, style, summary, contentHash);
    }

    public deleteChunkSummary(chunkId: string, style: "preview" | "summary"): void {
        deleteChunkSummary(this as any, chunkId, style);
    }

    public deleteChunkSummaries(chunkId: string): void {
        deleteChunkSummaries(this as any, chunkId);
    }

    public iterateChunkSummaries(
        visitor: (chunkId: string, styles: Record<"preview" | "summary", { summary: string; contentHash?: string }>) => void
    ): void {
        iterateChunkSummaries(this as any, visitor);
    }

    public compactChunkSummaries(): void {
        compactChunkSummaries();
    }

    public upsertPendingTransaction(entry: TransactionLogEntry): void {
        upsertPendingTransaction(this as any, entry);
    }

    public listPendingTransactions(): TransactionLogEntry[] {
        return listPendingTransactions(this as any);
    }

    public markTransactionCommitted(id: string, entry: TransactionLogEntry): void {
        markTransactionCommitted(this as any, id, entry);
    }

    public markTransactionRolledBack(id: string): void {
        markTransactionRolledBack(this as any, id);
    }

    public listTransactions(options?: { status?: "pending" | "committed" | "rolled_back"; limit?: number }): TransactionLogEntry[] {
        return listTransactions(this as any, options);
    }

    public close(): void {}

    public dispose(): void {}

    protected normalize(relPath: string): string {
        let normalized = relPath.replace(/\\/g, "/");
        const resolvedRoot = path.resolve(this.rootPath).replace(/\\/g, "/");
        const realRoot = fs.existsSync(this.rootPath)
            ? fs.realpathSync(this.rootPath).replace(/\\/g, "/")
            : resolvedRoot;

        const absoluteInput = path.isAbsolute(normalized)
            ? normalized
            : path.resolve(this.rootPath, normalized).replace(/\\/g, "/");

        if (absoluteInput.startsWith(realRoot)) {
            normalized = absoluteInput.substring(realRoot.length);
        } else if (absoluteInput.startsWith(resolvedRoot)) {
            normalized = absoluteInput.substring(resolvedRoot.length);
        }

        if (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }

        return normalized || ".";
    }

    protected rebuildSecondaryIndex(): void {
        rebuildSecondaryIndex(this as any);
    }

    protected resolveSecondaryIndexEnabled(): boolean {
        const raw = (process.env.KAIRO_SYMBOL_SECONDARY_INDEX ?? "auto").trim().toLowerCase();
        if (raw === "off" || raw === "false" || raw === "0") return false;
        if (raw === "on" || raw === "true" || raw === "1") return true;
        return true;
    }

    protected resolveSymbolSearchMaxCandidates(): number {
        const raw = Number.parseInt(process.env.KAIRO_SYMBOL_SEARCH_MAX_CANDIDATES ?? "20000", 10);
        if (!Number.isFinite(raw) || raw <= 0) return 20000;
        return raw;
    }

    private cleanupIncomingDependencies(targetPath: string): void {
        for (const [source, snapshot] of this.dependencies.entries()) {
            const filtered = snapshot.outgoing.filter(dep => dep.target !== targetPath);
            if (filtered.length !== snapshot.outgoing.length) {
                this.dependencies.set(source, { ...snapshot, outgoing: filtered });
            }
        }
    }
}
