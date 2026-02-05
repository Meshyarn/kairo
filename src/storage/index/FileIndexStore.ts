import * as fs from "fs";
import * as path from "path";
import { PathManager } from "../../utils/PathManager.js";
import { EmbeddingPackManager, resolveEmbeddingPackConfigFromEnv, type EmbeddingPackConfig } from "../EmbeddingPack.js";
import type {
    EmbeddingKey,
    FileRecord,
    StoredDocumentChunk,
    StoredEmbedding,
    StoredGhostSymbol,
    StoredUnresolvedDependency,
    TransactionLogEntry
} from "./IndexTypes.js";
import { MemoryIndexStore } from "./MemoryIndexStore.js";
import {
    ensureStorage,
    flushSecondaryIndex,
    loadFromDisk,
    loadSecondaryIndex,
    persistChunks,
    persistDependencies,
    persistDocumentMeta,
    persistEmbeddings,
    persistFiles,
    persistGhosts,
    persistPacks,
    persistSecondaryIndex,
    persistSummaries,
    persistSymbols,
    persistTransactions,
    resolveSecondaryIndexMaxBytes
} from "./FileIndexStorePersistence.js";
import {
    detectEmbeddingPackOnDisk,
    getEmbeddingPack,
    maybeMigrateEmbeddingPack
} from "./FileIndexStoreEmbeddingPack.js";
import type { SymbolInfo } from "../../types/ast.js";

export class FileIndexStore extends MemoryIndexStore {
    private readonly storageDir: string;
    private readonly manifestPath: string;
    private readonly filesPath: string;
    private readonly symbolsPath: string;
    private readonly secondaryIndexPath: string;
    private readonly dependenciesPath: string;
    private readonly ghostsPath: string;
    private readonly chunksPath: string;
    private readonly documentMetaPath: string;
    private readonly embeddingsPath: string;
    private readonly packsPath: string;
    private readonly summariesPath: string;
    private readonly transactionsPath: string;
    private readonly embeddingPackConfig: EmbeddingPackConfig;
    private readonly embeddingPacks = new Map<string, EmbeddingPackManager>();
    private readonly hasLegacyEmbeddingsOnDisk: boolean;
    private hasEmbeddingPackOnDisk: boolean;
    private secondaryIndexPersistTimer?: NodeJS.Timeout;

    constructor(rootPath: string, repoId?: string) {
        super(rootPath, "file");
        PathManager.setRoot(rootPath, repoId);
        this.embeddingPackConfig = resolveEmbeddingPackConfigFromEnv();
        this.storageDir = PathManager.getStorageDir(repoId);
        this.manifestPath = path.join(this.storageDir, "manifest.json");
        this.filesPath = path.join(this.storageDir, "files.json");
        this.symbolsPath = path.join(this.storageDir, "symbols.json");
        this.secondaryIndexPath = path.join(this.storageDir, "symbols_secondary_index.json");
        this.dependenciesPath = path.join(this.storageDir, "dependencies.json");
        this.ghostsPath = path.join(this.storageDir, "ghosts.json");
        this.chunksPath = path.join(this.storageDir, "chunks.json");
        this.documentMetaPath = path.join(this.storageDir, "document_meta.json");
        this.embeddingsPath = path.join(this.storageDir, "embeddings.json");
        this.packsPath = path.join(this.storageDir, "packs.json");
        this.summariesPath = path.join(this.storageDir, "summaries.json");
        this.transactionsPath = path.join(this.storageDir, "transactions.json");
        ensureStorage(this as any);
        this.hasLegacyEmbeddingsOnDisk = fs.existsSync(this.embeddingsPath) && fs.statSync(this.embeddingsPath).size > 2;
        this.hasEmbeddingPackOnDisk = this.embeddingPackConfig.enabled && (!this.hasLegacyEmbeddingsOnDisk || detectEmbeddingPackOnDisk(this as any));
        maybeMigrateEmbeddingPack(this as any);
        loadFromDisk(this as any);
        loadSecondaryIndex(this as any);
    }

    public override getOrCreateFile(relativePath: string, lastModified?: number, language?: string | null): FileRecord {
        const record = super.getOrCreateFile(relativePath, lastModified, language);
        this.persistFiles();
        return record;
    }

    public override updateFileMeta(
        relativePath: string,
        updates: { lastModified?: number; language?: string | null; contentHash?: string; sizeBytes?: number }
    ): FileRecord {
        const record = super.updateFileMeta(relativePath, updates);
        this.persistFiles();
        return record;
    }

    public override deleteFile(relativePath: string): void {
        super.deleteFile(relativePath);
        this.persistFiles();
        this.persistSymbols();
        this.persistSecondaryIndex();
        this.persistDependencies();
        this.persistChunks();
        this.persistDocumentMeta();
        if (!this.embeddingPackConfig.enabled || !this.hasEmbeddingPackOnDisk) {
            this.persistEmbeddings();
        }
    }

    public override deleteFilesByPrefix(prefix: string): void {
        super.deleteFilesByPrefix(prefix);
        this.persistFiles();
        this.persistSymbols();
        this.persistSecondaryIndex();
        this.persistDependencies();
        this.persistChunks();
        this.persistDocumentMeta();
        if (!this.embeddingPackConfig.enabled || !this.hasEmbeddingPackOnDisk) {
            this.persistEmbeddings();
        }
    }

    public override replaceSymbols(args: { relativePath: string; lastModified: number; language?: string | null; symbols: SymbolInfo[] }): void {
        super.replaceSymbols(args);
        this.persistFiles();
        this.persistSymbols();
        this.persistSecondaryIndex();
    }

    public override replaceDependencies(args: {
        relativePath: string;
        lastModified: number;
        outgoing: Array<{ targetPath?: string; type: string; weight?: number; metadata?: Record<string, unknown> }>;
        unresolved: StoredUnresolvedDependency[];
    }): void {
        super.replaceDependencies(args);
        this.persistFiles();
        this.persistDependencies();
    }

    public override clearDependencies(relativePath: string): void {
        super.clearDependencies(relativePath);
        this.persistDependencies();
    }

    public override addGhost(ghost: StoredGhostSymbol): void {
        super.addGhost(ghost);
        this.persistGhosts();
    }

    public override deleteGhost(name: string): void {
        super.deleteGhost(name);
        this.persistGhosts();
    }

    public override pruneGhosts(olderThanMs: number): void {
        super.pruneGhosts(olderThanMs);
        this.persistGhosts();
    }

    public override upsertDocumentChunks(filePath: string, chunks: StoredDocumentChunk[]): void {
        super.upsertDocumentChunks(filePath, chunks);
        this.persistChunks();
    }

    public override deleteDocumentChunks(filePath: string): void {
        super.deleteDocumentChunks(filePath);
        this.persistChunks();
    }

    public override upsertDocumentMeta(filePath: string, meta: any): void {
        super.upsertDocumentMeta(filePath, meta);
        this.persistDocumentMeta();
    }

    public override upsertEmbedding(chunkId: string, key: EmbeddingKey, embedding: { dims: number; vector: Float32Array; norm?: number }): void {
        if (this.embeddingPackConfig.enabled && this.hasEmbeddingPackOnDisk) {
            const pack = this.getEmbeddingPack(key);
            pack.upsertEmbedding(chunkId, embedding);
            pack.markReady();
            return;
        }
        super.upsertEmbedding(chunkId, key, embedding);
        this.persistEmbeddings();
    }

    public override getEmbedding(chunkId: string, key: EmbeddingKey): StoredEmbedding | null {
        if (this.embeddingPackConfig.enabled && this.hasEmbeddingPackOnDisk) {
            const pack = this.getEmbeddingPack(key);
            const embedding = pack.getEmbedding(chunkId);
            if (embedding) return embedding;
            return null;
        }
        return super.getEmbedding(chunkId, key);
    }

    public override deleteEmbedding(chunkId: string): void {
        if (this.embeddingPackConfig.enabled && this.hasEmbeddingPackOnDisk) {
            for (const pack of this.embeddingPacks.values()) {
                pack.deleteEmbedding(chunkId);
            }
            return;
        }
        super.deleteEmbedding(chunkId);
        this.persistEmbeddings();
    }

    public override deleteEmbeddingsForFile(filePath: string): void {
        const normalized = this.normalize(filePath);
        const chunkIds: string[] = [];
        for (const [chunkId, meta] of this.chunkIndex.entries()) {
            if (meta.filePath === normalized) {
                chunkIds.push(chunkId);
            }
        }
        if (this.embeddingPackConfig.enabled && this.hasEmbeddingPackOnDisk) {
            for (const chunkId of chunkIds) {
                for (const pack of this.embeddingPacks.values()) {
                    pack.deleteEmbedding(chunkId);
                }
            }
            return;
        }
        super.deleteEmbeddingsForFile(filePath);
        this.persistEmbeddings();
    }

    public override listEmbeddings(key: EmbeddingKey, limit?: number): StoredEmbedding[] {
        if (this.embeddingPackConfig.enabled && this.hasEmbeddingPackOnDisk) {
            return this.getEmbeddingPack(key).listEmbeddings(limit);
        }
        return super.listEmbeddings(key, limit);
    }

    public override iterateEmbeddings(key: EmbeddingKey, visitor: (embedding: StoredEmbedding) => void, options?: { limit?: number }): void {
        if (this.embeddingPackConfig.enabled && this.hasEmbeddingPackOnDisk) {
            this.getEmbeddingPack(key).iterateEmbeddings(visitor, options);
            return;
        }
        super.iterateEmbeddings(key, visitor, options);
    }

    public override upsertEvidencePack(packId: string, payload: unknown): void {
        super.upsertEvidencePack(packId, payload);
        this.persistPacks();
    }

    public override deleteEvidencePack(packId: string): void {
        super.deleteEvidencePack(packId);
        this.persistPacks();
    }

    public override compactEvidencePacks(): void {
        this.persistPacks();
    }

    public override upsertChunkSummary(chunkId: string, style: "preview" | "summary", summary: string, contentHash?: string): void {
        super.upsertChunkSummary(chunkId, style, summary, contentHash);
        this.persistSummaries();
    }

    public override deleteChunkSummary(chunkId: string, style: "preview" | "summary"): void {
        super.deleteChunkSummary(chunkId, style);
        this.persistSummaries();
    }

    public override deleteChunkSummaries(chunkId: string): void {
        super.deleteChunkSummaries(chunkId);
        this.persistSummaries();
    }

    public override compactChunkSummaries(): void {
        this.persistSummaries();
    }

    public override upsertPendingTransaction(entry: TransactionLogEntry): void {
        super.upsertPendingTransaction(entry);
        this.persistTransactions();
    }

    public override markTransactionCommitted(id: string, entry: TransactionLogEntry): void {
        super.markTransactionCommitted(id, entry);
        this.persistTransactions();
    }

    public override markTransactionRolledBack(id: string): void {
        super.markTransactionRolledBack(id);
        this.persistTransactions();
    }

    public override close(): void {
        if (this.secondaryIndexPersistTimer) {
            clearTimeout(this.secondaryIndexPersistTimer);
            this.secondaryIndexPersistTimer = undefined;
            this.flushSecondaryIndex();
        }
        if (this.embeddingPackConfig.enabled && this.hasEmbeddingPackOnDisk) {
            for (const pack of this.embeddingPacks.values()) {
                pack.close();
            }
        }
    }

    public override dispose(): void {
        this.close();
    }


    private persistFiles(): void {
        persistFiles(this as any);
    }

    private persistSymbols(): void {
        persistSymbols(this as any);
    }

    private persistSecondaryIndex(): void {
        persistSecondaryIndex(this as any);
    }

    private flushSecondaryIndex(): void {
        flushSecondaryIndex(this as any);
    }

    private resolveSecondaryIndexMaxBytes(): number {
        return resolveSecondaryIndexMaxBytes();
    }

    private persistDependencies(): void {
        persistDependencies(this as any);
    }

    private persistGhosts(): void {
        persistGhosts(this as any);
    }

    private persistChunks(): void {
        persistChunks(this as any);
    }

    private persistDocumentMeta(): void {
        persistDocumentMeta(this as any);
    }

    private persistEmbeddings(): void {
        persistEmbeddings(this as any);
    }

    private getEmbeddingPack(key: EmbeddingKey): EmbeddingPackManager {
        return getEmbeddingPack(this as any, key);
    }

    private persistPacks(): void {
        persistPacks(this as any);
    }

    private persistSummaries(): void {
        persistSummaries(this as any);
    }

    private persistTransactions(): void {
        persistTransactions(this as any);
    }
}
