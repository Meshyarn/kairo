import * as fs from "fs";
import * as path from "path";
import { PathManager } from "../../utils/PathManager.js";
import type { SymbolInfo } from "../../types.js";
import { EmbeddingPackManager, resolveEmbeddingPackConfigFromEnv, type EmbeddingPackConfig } from "../EmbeddingPack.js";
import { decodeVector, embeddingKey, encodeVector, normalizeLikePattern } from "./IndexCache.js";
import { readJson } from "./IndexReader.js";
import { writeJson } from "./IndexWriter.js";
import type {
    DependencySnapshot,
    EmbeddingKey,
    FileRecord,
    IndexStore,
    PersistedEmbedding,
    PersistedTransaction,
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

    public deleteFile(relativePath: string): void {
        const normalized = this.normalize(relativePath);
        this.removeSecondaryIndexForFile(normalized);
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
        const normalized = this.normalize(args.relativePath);
        this.removeSecondaryIndexForFile(normalized);
        this.getOrCreateFile(normalized, args.lastModified, args.language);
        this.symbols.set(normalized, [...(args.symbols ?? [])]);
        this.addSecondaryIndexForFile(normalized, args.symbols ?? []);
    }

    public readSymbols(relativePath: string): SymbolInfo[] | undefined {
        const normalized = this.normalize(relativePath);
        const stored = this.symbols.get(normalized);
        return stored ? stored.map(symbol => ({ ...symbol })) : undefined;
    }

    public streamAllSymbols(): Map<string, SymbolInfo[]> {
        const map = new Map<string, SymbolInfo[]>();
        for (const [key, symbols] of this.symbols.entries()) {
            map.set(key, symbols.map(symbol => ({ ...symbol })));
        }
        return map;
    }

    public searchSymbols(pattern: string, limit: number = 100): Array<{ path: string; data_json: string }> {
        const query = normalizeLikePattern(pattern);
        if (!query) return [];
        if (!this.symbolSecondaryIndexEnabled || query.length < 3) {
            return this.searchSymbolsLinear(query, limit);
        }
        if (this.symbolRefsByTrigram.size === 0) {
            return this.searchSymbolsLinear(query, limit);
        }
        const candidates = this.collectSecondaryCandidates(query);
        if (!candidates) {
            return this.searchSymbolsLinear(query, limit);
        }
        const cap = this.resolveSymbolSearchMaxCandidates();
        const sliced = cap > 0 && candidates.length > cap ? candidates.slice(0, cap) : candidates;
        const results: Array<{ path: string; data_json: string }> = [];
        for (const ref of sliced) {
            const resolved = this.resolveSymbolRef(ref);
            if (!resolved?.symbol?.name) continue;
            if (!resolved.symbol.name.toLowerCase().includes(query)) continue;
            results.push({ path: resolved.filePath, data_json: JSON.stringify(resolved.symbol) });
            if (results.length >= limit) {
                return results;
            }
        }
        return results;
    }

    public getSecondaryIndexStatus(): { enabled: boolean; bytes?: number } {
        return {
            enabled: this.symbolSecondaryIndexEnabled,
            bytes: this.symbolSecondaryIndexBytes
        };
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
        this.ghosts.set(ghost.name, { ...ghost });
    }

    public findGhost(name: string): StoredGhostSymbol | undefined {
        const ghost = this.ghosts.get(name);
        return ghost ? { ...ghost } : undefined;
    }

    public listGhosts(): StoredGhostSymbol[] {
        return Array.from(this.ghosts.values()).map(ghost => ({ ...ghost }));
    }

    public deleteGhost(name: string): void {
        this.ghosts.delete(name);
    }

    public pruneGhosts(olderThanMs: number): void {
        const cutoff = Date.now() - olderThanMs;
        for (const [name, ghost] of this.ghosts.entries()) {
            if (ghost.deletedAt < cutoff) {
                this.ghosts.delete(name);
            }
        }
    }

    public upsertDocumentChunks(filePath: string, chunks: StoredDocumentChunk[]): void {
        const normalized = this.normalize(filePath);
        const copy = chunks.map(chunk => ({ ...chunk, filePath: normalized }));
        const previous = this.documentChunks.get(normalized) ?? [];
        for (const chunk of previous) {
            this.chunkIndex.delete(chunk.id);
        }
        this.documentChunks.set(normalized, copy);
        for (const chunk of copy) {
            this.chunkIndex.set(chunk.id, { filePath: normalized, contentHash: chunk.contentHash });
        }
    }

    public listDocumentChunks(filePath: string): StoredDocumentChunk[] {
        const normalized = this.normalize(filePath);
        const chunks = this.documentChunks.get(normalized) ?? [];
        return chunks
            .slice()
            .sort((a, b) => a.range.startLine - b.range.startLine)
            .map(chunk => ({ ...chunk, sectionPath: [...(chunk.sectionPath ?? [])] }));
    }

    public listDocumentFiles(limit: number = 500): string[] {
        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 500;
        const fast = process.env.KAIRO_DOC_LIST_FAST === "true";
        if (fast) {
            const results: string[] = [];
            for (const key of this.documentChunks.keys()) {
                results.push(key);
                if (results.length >= safeLimit) break;
            }
            return results;
        }
        return Array.from(this.documentChunks.keys()).sort().slice(0, safeLimit);
    }

    public getChunkContentHash(chunkId: string): string | undefined {
        return this.chunkIndex.get(chunkId)?.contentHash;
    }

    public getDocumentChunk(chunkId: string): StoredDocumentChunk | null {
        const meta = this.chunkIndex.get(chunkId);
        if (!meta) return null;
        const chunks = this.documentChunks.get(meta.filePath) ?? [];
        const found = chunks.find(chunk => chunk.id === chunkId);
        return found ? { ...found, sectionPath: [...(found.sectionPath ?? [])] } : null;
    }

    public deleteDocumentChunks(filePath: string): void {
        const normalized = this.normalize(filePath);
        const chunks = this.documentChunks.get(normalized) ?? [];
        for (const chunk of chunks) {
            this.chunkIndex.delete(chunk.id);
        }
        this.documentChunks.delete(normalized);
    }

    public upsertDocumentMeta(filePath: string, meta: { filePath: string; sourceFormat: string; extractor?: string; warnings?: string[]; reasons?: string[]; stats?: Record<string, unknown>; updatedAt: number }): void {
        const normalized = this.normalize(filePath);
        this.documentMeta.set(normalized, {
            sourceFormat: meta.sourceFormat,
            extractor: meta.extractor,
            warnings: meta.warnings ? [...meta.warnings] : undefined,
            reasons: meta.reasons ? [...meta.reasons] : undefined,
            stats: meta.stats ? { ...meta.stats } : undefined,
            updatedAt: meta.updatedAt
        });
    }

    public getDocumentMeta(filePath: string): { filePath: string; sourceFormat: string; extractor?: string; warnings?: string[]; reasons?: string[]; stats?: Record<string, unknown>; updatedAt: number } | null {
        const normalized = this.normalize(filePath);
        const stored = this.documentMeta.get(normalized);
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
    }

    public upsertEmbedding(chunkId: string, key: EmbeddingKey, embedding: { dims: number; vector: Float32Array; norm?: number }): void {
        const mapKey = embeddingKey(key);
        const entry: StoredEmbedding = {
            chunkId,
            provider: key.provider,
            model: key.model,
            dims: embedding.dims,
            vector: embedding.vector,
            norm: embedding.norm
        };
        if (!this.embeddings.has(chunkId)) {
            this.embeddings.set(chunkId, new Map());
        }
        this.embeddings.get(chunkId)!.set(mapKey, entry);
    }

    public getEmbedding(chunkId: string, key: EmbeddingKey): StoredEmbedding | null {
        const mapKey = embeddingKey(key);
        const entry = this.embeddings.get(chunkId)?.get(mapKey);
        if (!entry) return null;
        return {
            ...entry,
            vector: new Float32Array(entry.vector)
        };
    }

    public deleteEmbedding(chunkId: string): void {
        this.embeddings.delete(chunkId);
    }

    public deleteEmbeddingsForFile(filePath: string): void {
        const normalized = this.normalize(filePath);
        for (const [chunkId, meta] of this.chunkIndex.entries()) {
            if (meta.filePath === normalized) {
                this.embeddings.delete(chunkId);
            }
        }
    }

    public listEmbeddings(key: EmbeddingKey, limit?: number): StoredEmbedding[] {
        const mapKey = embeddingKey(key);
        const max = Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : undefined;
        const results: StoredEmbedding[] = [];
        for (const [chunkId, variants] of this.embeddings.entries()) {
            const entry = variants.get(mapKey);
            if (!entry) continue;
            results.push({
                ...entry,
                vector: new Float32Array(entry.vector)
            });
            if (max && results.length >= max) break;
        }
        return results;
    }

    public iterateEmbeddings(key: EmbeddingKey, visitor: (embedding: StoredEmbedding) => void, options?: { limit?: number }): void {
        const mapKey = embeddingKey(key);
        const max = Number.isFinite(options?.limit) && (options?.limit as number) > 0 ? Math.floor(options?.limit as number) : undefined;
        let count = 0;
        for (const variants of this.embeddings.values()) {
            const entry = variants.get(mapKey);
            if (!entry) continue;
            visitor({
                ...entry,
                vector: new Float32Array(entry.vector)
            });
            count++;
            if (max && count >= max) break;
        }
    }

    public upsertEvidencePack(packId: string, payload: unknown): void {
        this.evidencePacks.set(packId, payload);
    }

    public getEvidencePack(packId: string): unknown | null {
        return this.evidencePacks.get(packId) ?? null;
    }

    public deleteEvidencePack(packId: string): void {
        this.evidencePacks.delete(packId);
    }

    public iterateEvidencePacks(visitor: (packId: string, payload: unknown) => void): void {
        for (const [packId, payload] of this.evidencePacks.entries()) {
            visitor(packId, payload);
        }
    }

    public compactEvidencePacks(): void {
        // No-op for in-memory store.
    }

    public getChunkSummary(chunkId: string, style: "preview" | "summary"): { summary: string; contentHash?: string } | null {
        const entry = this.chunkSummaries.get(chunkId)?.get(style);
        if (!entry) return null;
        return { ...entry };
    }

    public upsertChunkSummary(chunkId: string, style: "preview" | "summary", summary: string, contentHash?: string): void {
        if (!this.chunkSummaries.has(chunkId)) {
            this.chunkSummaries.set(chunkId, new Map());
        }
        this.chunkSummaries.get(chunkId)!.set(style, { summary, contentHash });
    }

    public deleteChunkSummary(chunkId: string, style: "preview" | "summary"): void {
        const styles = this.chunkSummaries.get(chunkId);
        if (!styles) return;
        styles.delete(style);
        if (styles.size === 0) {
            this.chunkSummaries.delete(chunkId);
        }
    }

    public deleteChunkSummaries(chunkId: string): void {
        this.chunkSummaries.delete(chunkId);
    }

    public iterateChunkSummaries(
        visitor: (chunkId: string, styles: Record<"preview" | "summary", { summary: string; contentHash?: string }>) => void
    ): void {
        for (const [chunkId, styles] of this.chunkSummaries.entries()) {
            const payload: Record<"preview" | "summary", { summary: string; contentHash?: string }> = {} as any;
            for (const [style, value] of styles.entries()) {
                if (style !== "preview" && style !== "summary") continue;
                payload[style as "preview" | "summary"] = { ...value };
            }
            visitor(chunkId, payload);
        }
    }

    public compactChunkSummaries(): void {
        // No-op for in-memory store.
    }

    public upsertPendingTransaction(entry: TransactionLogEntry): void {
        this.transactions.set(entry.id, { ...entry });
    }

    public listPendingTransactions(): TransactionLogEntry[] {
        const entries: TransactionLogEntry[] = [];
        for (const entry of this.transactions.values()) {
            if (entry.status === "pending") {
                entries.push(this.cloneTransaction(entry));
            }
        }
        return entries.sort((a, b) => a.timestamp - b.timestamp);
    }

    public markTransactionCommitted(id: string, entry: TransactionLogEntry): void {
        this.transactions.set(id, { ...entry, status: "committed" });
    }

    public markTransactionRolledBack(id: string): void {
        const entry = this.transactions.get(id);
        if (!entry) return;
        this.transactions.set(id, { ...entry, status: "rolled_back" });
    }

    public listTransactions(options?: { status?: "pending" | "committed" | "rolled_back"; limit?: number }): TransactionLogEntry[] {
        const status = options?.status;
        const entries: TransactionLogEntry[] = [];
        for (const entry of this.transactions.values()) {
            if (status && entry.status !== status) continue;
            entries.push(this.cloneTransaction(entry));
        }
        entries.sort((a, b) => b.timestamp - a.timestamp);
        if (typeof options?.limit === "number") {
            return entries.slice(0, Math.max(0, options.limit));
        }
        return entries;
    }

    public close(): void {}

    public dispose(): void {}

    private cloneTransaction(entry: TransactionLogEntry): TransactionLogEntry {
        return {
            ...entry,
            diffSummary: entry.diffSummary ? { ...entry.diffSummary } : undefined,
            filesTouched: entry.filesTouched ? entry.filesTouched.map(item => ({ ...item })) : undefined,
            snapshots: entry.snapshots.map(snapshot => ({ ...snapshot }))
        };
    }

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

    private searchSymbolsLinear(query: string, limit: number): Array<{ path: string; data_json: string }> {
        const results: Array<{ path: string; data_json: string }> = [];
        for (const [filePath, symbols] of this.symbols.entries()) {
            for (const symbol of symbols) {
                if (!symbol?.name) continue;
                if (!symbol.name.toLowerCase().includes(query)) continue;
                results.push({ path: filePath, data_json: JSON.stringify(symbol) });
                if (results.length >= limit) {
                    return results;
                }
            }
        }
        return results;
    }

    private collectSecondaryCandidates(query: string): string[] | null {
        const trigrams = this.toTrigrams(query);
        if (trigrams.length === 0) return null;
        const sets: Set<string>[] = [];
        for (const trigram of trigrams) {
            const set = this.symbolRefsByTrigram.get(trigram);
            if (!set || set.size === 0) {
                return [];
            }
            sets.push(set);
        }
        sets.sort((a, b) => a.size - b.size);
        let candidates = new Set(sets[0]);
        for (let i = 1; i < sets.length; i++) {
            const next = sets[i];
            for (const ref of candidates) {
                if (!next.has(ref)) {
                    candidates.delete(ref);
                }
            }
            if (candidates.size === 0) break;
        }
        return Array.from(candidates);
    }

    private resolveSymbolRef(ref: string): { filePath: string; symbol: SymbolInfo } | null {
        const splitIndex = ref.lastIndexOf("#");
        if (splitIndex <= 0) return null;
        const filePath = ref.slice(0, splitIndex);
        const ordinal = Number.parseInt(ref.slice(splitIndex + 1), 10);
        if (!Number.isFinite(ordinal) || ordinal < 0) return null;
        const symbols = this.symbols.get(filePath);
        const symbol = symbols?.[ordinal];
        if (!symbol) return null;
        return { filePath, symbol };
    }

    private addSecondaryIndexForFile(filePath: string, symbols: SymbolInfo[]): void {
        if (!this.symbolSecondaryIndexEnabled) return;
        symbols.forEach((symbol, index) => {
            if (!symbol?.name) return;
            const ref = this.buildSymbolRef(filePath, index);
            const trigrams = this.toTrigrams(symbol.name.toLowerCase());
            if (trigrams.length === 0) return;
            for (const trigram of trigrams) {
                let set = this.symbolRefsByTrigram.get(trigram);
                if (!set) {
                    set = new Set();
                    this.symbolRefsByTrigram.set(trigram, set);
                }
                set.add(ref);
            }
        });
    }

    private removeSecondaryIndexForFile(filePath: string): void {
        if (!this.symbolSecondaryIndexEnabled) return;
        const symbols = this.symbols.get(filePath) ?? [];
        symbols.forEach((symbol, index) => {
            if (!symbol?.name) return;
            const ref = this.buildSymbolRef(filePath, index);
            const trigrams = this.toTrigrams(symbol.name.toLowerCase());
            for (const trigram of trigrams) {
                const set = this.symbolRefsByTrigram.get(trigram);
                if (!set) continue;
                set.delete(ref);
                if (set.size === 0) {
                    this.symbolRefsByTrigram.delete(trigram);
                }
            }
        });
    }

    protected rebuildSecondaryIndex(): void {
        if (!this.symbolSecondaryIndexEnabled) {
            this.symbolRefsByTrigram.clear();
            return;
        }
        this.symbolRefsByTrigram.clear();
        for (const [filePath, symbols] of this.symbols.entries()) {
            this.addSecondaryIndexForFile(filePath, symbols);
        }
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

    private toTrigrams(input: string): string[] {
        const normalized = input.trim().toLowerCase();
        if (normalized.length < 3) return [];
        if (normalized.length === 3) return [normalized];
        const trigrams: string[] = [];
        for (let i = 0; i <= normalized.length - 3; i++) {
            trigrams.push(normalized.slice(i, i + 3));
        }
        return trigrams;
    }

    private buildSymbolRef(filePath: string, ordinal: number): string {
        return `${filePath}#${ordinal}`;
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
        this.ensureStorage();
        this.hasLegacyEmbeddingsOnDisk = fs.existsSync(this.embeddingsPath) && fs.statSync(this.embeddingsPath).size > 2;
        this.hasEmbeddingPackOnDisk = this.embeddingPackConfig.enabled && (!this.hasLegacyEmbeddingsOnDisk || this.detectEmbeddingPackOnDisk());
        this.maybeMigrateEmbeddingPack();
        this.loadFromDisk();
        this.loadSecondaryIndex();
    }

    public override getOrCreateFile(relativePath: string, lastModified?: number, language?: string | null): FileRecord {
        const record = super.getOrCreateFile(relativePath, lastModified, language);
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

    private ensureStorage(): void {
        fs.mkdirSync(this.storageDir, { recursive: true });
        if (!fs.existsSync(this.manifestPath)) {
            writeJson(this.manifestPath, { version: 0, createdAt: new Date().toISOString() });
        }
    }

    private loadFromDisk(): void {
        const files = readJson<FileRecord[]>(this.filesPath, []);
        for (const record of files) {
            if (record?.path) {
                this.files.set(record.path, { ...record });
            }
        }

        const symbols = readJson<Record<string, SymbolInfo[]>>(this.symbolsPath, {});
        for (const [filePath, entries] of Object.entries(symbols)) {
            const record = this.getFile(filePath);
            super.getOrCreateFile(filePath, record?.last_modified ?? Date.now(), record?.language ?? null);
            this.symbols.set(this.normalize(filePath), entries ?? []);
        }

        const deps = readJson<Record<string, DependencySnapshot>>(this.dependenciesPath, {});
        for (const [filePath, snapshot] of Object.entries(deps)) {
            this.dependencies.set(filePath, {
                outgoing: snapshot.outgoing ?? [],
                unresolved: snapshot.unresolved ?? []
            });
        }

        const ghosts = readJson<StoredGhostSymbol[]>(this.ghostsPath, []);
        for (const ghost of ghosts) {
            if (ghost?.name) {
                super.addGhost(ghost);
            }
        }

        const chunks = readJson<Record<string, StoredDocumentChunk[]>>(this.chunksPath, {});
        for (const [filePath, entries] of Object.entries(chunks)) {
            super.upsertDocumentChunks(filePath, entries ?? []);
        }

        const metas = readJson<Record<string, any>>(this.documentMetaPath, {});
        for (const [filePath, meta] of Object.entries(metas)) {
            if (!meta || typeof meta !== "object") continue;
            if (typeof (meta as any).sourceFormat !== "string") continue;
            super.upsertDocumentMeta(filePath, {
                filePath,
                sourceFormat: String((meta as any).sourceFormat),
                extractor: typeof (meta as any).extractor === "string" ? (meta as any).extractor : undefined,
                warnings: Array.isArray((meta as any).warnings) ? (meta as any).warnings.map((v: any) => String(v)) : undefined,
                reasons: Array.isArray((meta as any).reasons) ? (meta as any).reasons.map((v: any) => String(v)) : undefined,
                stats: (meta as any).stats && typeof (meta as any).stats === "object" ? (meta as any).stats : undefined,
                updatedAt: Number.isFinite((meta as any).updatedAt) ? (meta as any).updatedAt : Date.now()
            });
        }

        if (!this.embeddingPackConfig.enabled || !this.hasEmbeddingPackOnDisk) {
            const embeddings = readJson<Record<string, Record<string, PersistedEmbedding>>>(this.embeddingsPath, {});
            for (const [chunkId, variants] of Object.entries(embeddings)) {
                for (const [variantKey, payload] of Object.entries(variants ?? {})) {
                    if (!payload?.vector) continue;
                    const vector = decodeVector(payload.vector);
                    const [provider, model] = variantKey.split("::", 2);
                    if (!provider || !model) continue;
                    super.upsertEmbedding(chunkId, { provider, model }, {
                        dims: payload.dims,
                        vector,
                        norm: payload.norm
                    });
                }
            }
        }

        const packs = readJson<Record<string, unknown>>(this.packsPath, {});
        for (const [packId, payload] of Object.entries(packs)) {
            super.upsertEvidencePack(packId, payload);
        }

        const summaries = readJson<Record<string, Record<string, { summary: string; contentHash?: string }>>>(this.summariesPath, {});
        for (const [chunkId, styles] of Object.entries(summaries)) {
            for (const [style, payload] of Object.entries(styles ?? {})) {
                if (style !== "preview" && style !== "summary") continue;
                if (!payload?.summary) continue;
                super.upsertChunkSummary(chunkId, style as "preview" | "summary", payload.summary, payload.contentHash);
            }
        }

        const transactions = readJson<Record<string, PersistedTransaction>>(this.transactionsPath, {});
        for (const entry of Object.values(transactions)) {
            if (entry?.id) {
                super.upsertPendingTransaction(entry);
            }
        }
    }

    private persistFiles(): void {
        writeJson(this.filesPath, this.listFiles());
    }

    private persistSymbols(): void {
        const payload: Record<string, SymbolInfo[]> = {};
        for (const [filePath, entries] of this.streamAllSymbols().entries()) {
            payload[filePath] = entries;
        }
        writeJson(this.symbolsPath, payload);
    }

    private loadSecondaryIndex(): void {
        if (!this.symbolSecondaryIndexEnabled) {
            this.symbolRefsByTrigram.clear();
            this.symbolSecondaryIndexBytes = 0;
            return;
        }
        const maxBytes = this.resolveSecondaryIndexMaxBytes();
        if (!fs.existsSync(this.secondaryIndexPath)) {
            this.rebuildSecondaryIndex();
            this.persistSecondaryIndex();
            return;
        }
        try {
            const size = fs.statSync(this.secondaryIndexPath).size;
            this.symbolSecondaryIndexBytes = size;
            if (maxBytes > 0 && size > maxBytes) {
                this.symbolSecondaryIndexEnabled = false;
                this.symbolRefsByTrigram.clear();
                fs.rmSync(this.secondaryIndexPath, { force: true });
                return;
            }
        } catch {
            // best-effort
        }
        const payload = readJson<{ version?: number; trigrams?: Record<string, string[]> } | null>(this.secondaryIndexPath, null);
        if (!payload || payload.version !== 1 || !payload.trigrams || typeof payload.trigrams !== "object") {
            this.rebuildSecondaryIndex();
            this.persistSecondaryIndex();
            return;
        }
        this.symbolRefsByTrigram.clear();
        for (const [trigram, refs] of Object.entries(payload.trigrams)) {
            if (!Array.isArray(refs) || refs.length === 0) continue;
            this.symbolRefsByTrigram.set(trigram, new Set(refs.filter(Boolean)));
        }
        if (!Number.isFinite(this.symbolSecondaryIndexBytes)) {
            this.symbolSecondaryIndexBytes = 0;
        }
    }

    private persistSecondaryIndex(): void {
        if (!this.symbolSecondaryIndexEnabled) return;
        if (this.secondaryIndexPersistTimer) return;
        this.secondaryIndexPersistTimer = setTimeout(() => {
            this.secondaryIndexPersistTimer = undefined;
            this.flushSecondaryIndex();
        }, 250);
    }

    private flushSecondaryIndex(): void {
        if (!this.symbolSecondaryIndexEnabled) return;
        const payload = this.buildSecondaryIndexPayload();
        const json = JSON.stringify(payload);
        const size = Buffer.byteLength(json);
        const maxBytes = this.resolveSecondaryIndexMaxBytes();
        if (maxBytes > 0 && size > maxBytes) {
            this.symbolSecondaryIndexEnabled = false;
            this.symbolRefsByTrigram.clear();
            this.symbolSecondaryIndexBytes = size;
            try {
                fs.rmSync(this.secondaryIndexPath, { force: true });
            } catch {
                // best-effort
            }
            return;
        }
        const dir = path.dirname(this.secondaryIndexPath);
        fs.mkdirSync(dir, { recursive: true });
        const tmpPath = `${this.secondaryIndexPath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmpPath, json);
        fs.renameSync(tmpPath, this.secondaryIndexPath);
        this.symbolSecondaryIndexBytes = size;
    }

    private resolveSecondaryIndexMaxBytes(): number {
        const raw = Number.parseInt(process.env.KAIRO_SYMBOL_SECONDARY_INDEX_MAX_BYTES ?? "67108864", 10);
        if (!Number.isFinite(raw) || raw <= 0) return 0;
        return raw;
    }

    private buildSecondaryIndexPayload(): { version: number; trigrams: Record<string, string[]> } {
        const trigrams: Record<string, string[]> = {};
        for (const [key, refs] of this.symbolRefsByTrigram.entries()) {
            trigrams[key] = Array.from(refs);
        }
        return { version: 1, trigrams };
    }

    private persistDependencies(): void {
        const payload: Record<string, DependencySnapshot> = {};
        for (const [filePath, snapshot] of this.dependencies.entries()) {
            payload[filePath] = snapshot;
        }
        writeJson(this.dependenciesPath, payload);
    }

    private persistGhosts(): void {
        writeJson(this.ghostsPath, this.listGhosts());
    }

    private persistChunks(): void {
        const payload: Record<string, StoredDocumentChunk[]> = {};
        for (const [filePath, chunks] of this.documentChunks.entries()) {
            payload[filePath] = chunks;
        }
        writeJson(this.chunksPath, payload);
    }

    private persistDocumentMeta(): void {
        const payload: Record<string, unknown> = {};
        for (const [filePath, meta] of this.documentMeta.entries()) {
            payload[filePath] = meta;
        }
        writeJson(this.documentMetaPath, payload);
    }

    private persistEmbeddings(): void {
        if (this.embeddingPackConfig.enabled && this.hasEmbeddingPackOnDisk) {
            for (const pack of this.embeddingPacks.values()) {
                pack.flush();
            }
            return;
        }
        const payload: Record<string, Record<string, PersistedEmbedding>> = {};
        for (const [chunkId, variants] of this.embeddings.entries()) {
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
        writeJson(this.embeddingsPath, payload);
    }

    private getEmbeddingPack(key: EmbeddingKey): EmbeddingPackManager {
        const mapKey = embeddingKey(key);
        const existing = this.embeddingPacks.get(mapKey);
        if (existing) return existing;
        const pack = new EmbeddingPackManager(key, this.embeddingPackConfig);
        this.embeddingPacks.set(mapKey, pack);
        return pack;
    }

    private detectEmbeddingPackOnDisk(): boolean {
        const v1Dir = path.join(this.storageDir, "v1", "embeddings");
        if (!fs.existsSync(v1Dir)) return false;
        try {
            const providers = fs.readdirSync(v1Dir);
            for (const provider of providers) {
                const providerDir = path.join(v1Dir, provider);
                if (!fs.statSync(providerDir).isDirectory()) continue;
                const models = fs.readdirSync(providerDir);
                for (const model of models) {
                    const dir = path.join(providerDir, model);
                    if (!fs.statSync(dir).isDirectory()) continue;
                    const readyPath = path.join(dir, "ready.json");
                    if (fs.existsSync(readyPath)) return true;
                }
            }
        } catch {
            return false;
        }
        return false;
    }

    private maybeMigrateEmbeddingPack(): void {
        if (!this.embeddingPackConfig.enabled || !this.hasLegacyEmbeddingsOnDisk) return;
        if (this.embeddingPackConfig.rebuild === "manual") return;
        const hasReadyPack = this.detectEmbeddingPackOnDisk();
        if (this.embeddingPackConfig.rebuild === "auto" && hasReadyPack) {
            this.hasEmbeddingPackOnDisk = true;
            return;
        }

        try {
            if (this.embeddingPackConfig.rebuild === "on_start") {
                const v1Dir = path.join(this.storageDir, "v1", "embeddings");
                fs.rmSync(v1Dir, { recursive: true, force: true });
            }

            const embeddings = readJson<Record<string, Record<string, PersistedEmbedding>>>(this.embeddingsPath, {});
            const packs = new Map<string, EmbeddingPackManager>();
            let wrote = false;

            for (const [chunkId, variants] of Object.entries(embeddings)) {
                for (const [variantKey, payload] of Object.entries(variants ?? {})) {
                    if (!payload?.vector) continue;
                    const [provider, model] = variantKey.split("::", 2);
                    if (!provider || !model) continue;
                    const packKey = `${provider}::${model}`;
                    let pack = packs.get(packKey);
                    if (!pack) {
                        pack = new EmbeddingPackManager({ provider, model }, this.embeddingPackConfig);
                        packs.set(packKey, pack);
                    }
                    const vector = decodeVector(payload.vector);
                    pack.upsertEmbedding(chunkId, { dims: payload.dims, vector, norm: payload.norm });
                    wrote = true;
                }
            }

            for (const pack of packs.values()) {
                pack.markReady();
                pack.close();
            }

            if (wrote) {
                this.hasEmbeddingPackOnDisk = true;
            }
        } catch (err) {
            console.warn("[embedding-pack] Failed to migrate legacy embeddings pack:", err);
        }
    }

    private persistPacks(): void {
        const payload: Record<string, unknown> = {};
        for (const [packId, value] of this.evidencePacks.entries()) {
            payload[packId] = value;
        }
        writeJson(this.packsPath, payload);
    }

    private persistSummaries(): void {
        const payload: Record<string, Record<string, { summary: string; contentHash?: string }>> = {};
        for (const [chunkId, styles] of this.chunkSummaries.entries()) {
            payload[chunkId] = {};
            for (const [style, value] of styles.entries()) {
                payload[chunkId][style] = value;
            }
        }
        writeJson(this.summariesPath, payload);
    }

    private persistTransactions(): void {
        const payload: Record<string, PersistedTransaction> = {};
        for (const [id, entry] of this.transactions.entries()) {
            payload[id] = entry;
        }
        writeJson(this.transactionsPath, payload);
    }

}
