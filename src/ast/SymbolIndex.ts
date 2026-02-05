import * as path from 'path';
import ignore from 'ignore';
import { LRUCache } from 'lru-cache';
import { SkeletonGenerator } from './SkeletonGenerator.js';
import { SymbolInfo } from '../types.js';
import { IndexDatabase } from '../indexing/IndexDatabase.js';
import { CommentIndexer } from '../indexing/CommentIndexer.js';
import { NodeFileSystem, type IFileSystem, type FileStats } from '../platform/FileSystem.js';
import { NativeSearchIndexer } from "../engine/search/native/NativeSearchIndexer.js";
import { PathManager } from "../utils/PathManager.js";
import { scanFiles, scanFilesAsync } from "./SymbolIndexScan.js";
import { fuzzySearch, searchAllSymbolsLinear, shouldRunFuzzySearch } from "./SymbolIndexSearch.js";

const SUPPORTED_EXTENSIONS = new Set<string>(['.ts', '.tsx', '.js', '.jsx', '.py']);
const HOT_CACHE_SIZE = 50;

export interface SymbolSearchResult {
    filePath: string;
    symbol: SymbolInfo;
}

interface CacheEntry {
    mtime: number;
    symbols: SymbolInfo[];
}

export class SymbolIndex {
    private readonly cache: LRUCache<string, CacheEntry>;
    private readonly rootPath: string;
    private readonly skeletonGenerator: SkeletonGenerator;
    private readonly fileSystem: IFileSystem;
    private ignoreFilter: ReturnType<typeof ignore.default>;
    private readonly db: IndexDatabase;
    private readonly commentIndexer: CommentIndexer;
    private userIgnorePatterns: string[];

    private baselinePromise?: Promise<void>;
    private baselineRequested = false;
    private readonly waitForBaselineByDefault: boolean;
    private editTracker: Map<string, number> = new Map();
    private pendingUpdates: Set<string> = new Set();
    private updateDebounceTimer?: NodeJS.Timeout;
    private disposed = false;
    private incrementalUpdatePromise: Promise<void> | null = null;
    constructor(
        rootPath: string,
        skeletonGenerator: SkeletonGenerator,
        ignorePatterns: string[],
        db?: IndexDatabase,
        fileSystem?: IFileSystem,
        options?: { nativeSearchIndexer?: NativeSearchIndexer; repoId?: string }
    ) {
        this.rootPath = rootPath;
        this.skeletonGenerator = skeletonGenerator;
        this.fileSystem = fileSystem ?? new NodeFileSystem(this.rootPath);
        this.userIgnorePatterns = [...ignorePatterns];
        this.ignoreFilter = this.createIgnoreFilter(this.userIgnorePatterns);
        this.db = db ?? new IndexDatabase(this.rootPath);
        this.commentIndexer = new CommentIndexer(this.db, {
            nativeSearchIndexer: options?.nativeSearchIndexer,
            repoId: options?.repoId
        });
        this.cache = new LRUCache({ max: HOT_CACHE_SIZE });
        this.waitForBaselineByDefault = this.resolveBaselineWaitMode();
    }

    public invalidateFile(filePath: string) {
        const relativePath = this.toRelative(filePath);
        this.cache.delete(relativePath);
    }

    public invalidateDirectory(dirPath: string) {
        const relativePath = this.toRelative(dirPath);
        if (!relativePath) {
            this.cache.clear();
            return;
        }
        for (const key of this.cache.keys()) {
            if (key === relativePath || key.startsWith(`${relativePath}/`)) {
                this.cache.delete(key);
            }
        }
    }

    public dropFileFromIndex(filePath: string) {
        const relative = this.toRelative(filePath);
        this.cache.delete(relative);
        this.db.deleteFile(relative);
    }

    public dropDirectoryFromIndex(dirPath: string) {
        const relative = this.toRelative(dirPath);
        if (!relative) {
            this.cache.clear();
        } else {
            for (const key of this.cache.keys()) {
                if (key === relative || key.startsWith(`${relative}/`)) {
                    this.cache.delete(key);
                }
            }
        }
        this.db.deleteFilesByPrefix(relative ?? '');
    }

    public clearCache() {
        this.cache.clear();
    }

    public updateIgnorePatterns(patterns: string[]): void {
        this.userIgnorePatterns = [...patterns];
        this.ignoreFilter = this.createIgnoreFilter(this.userIgnorePatterns);
    }

    public async search(query: string): Promise<SymbolSearchResult[]> {
        await this.ensureBaselineIndex();
        
        const pattern = `%${query}%`;
        const rows = this.db.searchSymbols(pattern, 100);
        
        const results = rows.map(row => ({
            filePath: row.path,
            symbol: JSON.parse(row.data_json) as SymbolInfo
        }));
        
        if (results.length > 0) {
            return results;
        }
        const fallback = searchAllSymbolsLinear(this.db, query, 100);
        if (fallback.length > 0) {
            return fallback;
        }
        if (!shouldRunFuzzySearch(this.db)) {
            return [];
        }
        return fuzzySearch(this.db, query, { maxEditDistance: 2 });
    }

    public async findFilesBySymbolName(keywords: string[]): Promise<string[]> {
        await this.ensureBaselineIndex();
        const filePaths = new Set<string>();
        
        for (const keyword of keywords) {
            const pattern = `%${keyword}%`;
            const rows = this.db.searchSymbols(pattern, 200);
            for (const row of rows) {
                filePaths.add(row.path);
            }
        }
        
        return Array.from(filePaths);
    }

    public async getAllSymbols(): Promise<Map<string, SymbolInfo[]>> {
        await this.ensureBaselineIndex();
        return this.db.streamAllSymbols();
    }

    public async getSymbolsForFile(filePath: string): Promise<SymbolInfo[]> {
        let stats: FileStats;
        try {
            const snapshot = this.fileSystem.statSync?.(filePath);
            if (!snapshot) {
                this.dropFileFromIndex(filePath);
                return [];
            }
            stats = snapshot;
        } catch {
            this.dropFileFromIndex(filePath);
            return [];
        }
        const currentMtime = stats.mtime;
        const relativePath = this.toRelative(filePath);
        const cached = this.cache.get(relativePath);
        if (cached && cached.mtime === currentMtime) {
            return cached.symbols;
        }

        const record = this.db.getFile(relativePath);
        if (record && record.last_modified === currentMtime) {
            const storedSymbols = this.db.readSymbols(relativePath);
            if (storedSymbols) {
                this.cache.set(relativePath, { mtime: currentMtime, symbols: storedSymbols });
                return storedSymbols;
            }
        }

        if (!this.isSupported(filePath)) {
            this.cache.set(relativePath, { mtime: currentMtime, symbols: [] });
            this.db.replaceSymbols({ relativePath, lastModified: currentMtime, symbols: [] });
            try {
                this.commentIndexer.upsertCommentChunksForFile(relativePath, []);
            } catch {
                // best-effort
            }
            return [];
        }

        const content = this.fileSystem.readFileSync?.(filePath) ?? await this.fileSystem.readFile(filePath);
        const symbols = await this.extractSymbols(filePath, content);
        this.cache.set(relativePath, { mtime: currentMtime, symbols });
        this.db.replaceSymbols({
            relativePath,
            lastModified: currentMtime,
            language: null,
            symbols
        });
        try {
            this.commentIndexer.upsertCommentChunksForFile(relativePath, symbols, content);
        } catch {
            // best-effort
        }
        return symbols;
    }

    public isSupported(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return SUPPORTED_EXTENSIONS.has(ext);
    }

    public shouldIgnore(relativePath: string): boolean {
        return !!relativePath && this.ignoreFilter.ignores(relativePath);
    }

    public getDatabase(): IndexDatabase {
        return this.db;
    }

    public getRootPath(): string {
        return this.rootPath;
    }

    public restoreFromCache(filePath: string, symbols: SymbolInfo[], mtime: number): void {
        const relativePath = this.toRelative(filePath);
        this.cache.set(relativePath, { mtime, symbols });
    }
    private async extractSymbols(filePath: string, content: string): Promise<SymbolInfo[]> {
        try {
            const structure = await this.skeletonGenerator.generateStructureJson(filePath, content);
            return structure.map((symbol: SymbolInfo) => {
                if (!symbol.content && symbol.range && typeof symbol.range.startByte === 'number' && typeof symbol.range.endByte === 'number') {
                    return {
                        ...symbol,
                        content: content.substring(symbol.range.startByte, symbol.range.endByte)
                    } as SymbolInfo;
                }
                return symbol;
            });
        } catch (error) {
            console.warn(`Symbol extraction failed for ${filePath}:`, error);
            return [];
        }
    }

    private toRelative(filePath: string): string {
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.rootPath, filePath);
        return path.relative(this.rootPath, absPath).replace(/\\/g, '/');
    }

    private async ensureBaselineIndex(waitForBaseline: boolean = this.waitForBaselineByDefault): Promise<void> {
        if (this.baselinePromise) {
            if (waitForBaseline) {
                await this.baselinePromise;
            }
            return;
        }
        if (!waitForBaseline) {
            this.startBaselineSync();
            return;
        }
        this.baselinePromise = this.syncWithDisk();
        try {
            await this.baselinePromise;
        } finally {
            this.baselinePromise = undefined;
        }
    }

    private startBaselineSync(): void {
        if (this.baselinePromise || this.baselineRequested) {
            return;
        }
        this.baselineRequested = true;
        this.baselinePromise = this.syncWithDiskAsync();
        this.baselinePromise.finally(() => {
            this.baselinePromise = undefined;
        });
    }

    private async syncWithDisk(): Promise<void> {
        const records = this.db.listFiles();
        const recordMap = new Map(records.map(record => [record.path, record]));
        const files = scanFiles({
            dir: this.rootPath,
            rootPath: this.rootPath,
            fileSystem: this.fileSystem,
            shouldIgnore: (relativePath) => this.shouldIgnore(relativePath),
            isSupported: (filePath) => this.isSupported(filePath)
        });
        const seen = new Set<string>();

        for (const filePath of files) {
            const relative = this.toRelative(filePath);
            seen.add(relative);
            let stats: FileStats;
            try {
                const snapshot = this.fileSystem.statSync?.(filePath);
                if (!snapshot) continue;
                stats = snapshot;
            } catch {
                continue;
            }
            const record = recordMap.get(relative);
            if (!record || record.last_modified !== stats.mtime) {
                await this.getSymbolsForFile(filePath);
            }
        }

        for (const record of recordMap.values()) {
            if (!seen.has(record.path)) {
                this.db.deleteFile(record.path);
                this.cache.delete(record.path);
            }
        }

    }

    private async syncWithDiskAsync(): Promise<void> {
        const records = this.db.listFiles();
        const recordMap = new Map(records.map(record => [record.path, record]));
        const files = await scanFilesAsync({
            dir: this.rootPath,
            rootPath: this.rootPath,
            fileSystem: this.fileSystem,
            shouldIgnore: (relativePath) => this.shouldIgnore(relativePath),
            isSupported: (filePath) => this.isSupported(filePath)
        });
        const seen = new Set<string>();

        for (const filePath of files) {
            const relative = this.toRelative(filePath);
            seen.add(relative);
            let stats: FileStats;
            try {
                stats = await this.fileSystem.stat(filePath);
            } catch {
                continue;
            }
            const record = recordMap.get(relative);
            if (!record || record.last_modified !== stats.mtime) {
                await this.getSymbolsForFile(filePath);
            }
        }

        for (const record of recordMap.values()) {
            if (!seen.has(record.path)) {
                this.db.deleteFile(record.path);
                this.cache.delete(record.path);
            }
        }
    }

    private resolveBaselineWaitMode(): boolean {
        const raw = (process.env.KAIRO_BASELINE_BLOCKING ?? "").trim().toLowerCase();
        if (raw === "true" || raw === "1") return true;
        if (raw === "false" || raw === "0") return false;
        return process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
    }

    public fuzzySearch(
        query: string,
        options: { maxEditDistance: number; scoreThreshold?: number }
    ): SymbolSearchResult[] {
        return fuzzySearch(this.db, query, options);
    }

    public async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
            this.updateDebounceTimer = undefined;
        }

        if (this.incrementalUpdatePromise) {
            await this.incrementalUpdatePromise;
        }

        this.pendingUpdates.clear();
        this.editTracker.clear();
    }

    public markFileModified(filepath: string): void {
        if (this.disposed) {
            return;
        }
        this.editTracker.set(filepath, Date.now());
        this.pendingUpdates.add(filepath);
        this.scheduleIncrementalUpdate();
    }

    private scheduleIncrementalUpdate(): void {
        if (this.disposed) {
            return;
        }
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }

        this.updateDebounceTimer = setTimeout(() => {
            if (!this.incrementalUpdatePromise) {
                this.incrementalUpdatePromise = this.incrementalUpdate().finally(() => {
                    this.incrementalUpdatePromise = null;
                });
            }
        }, 500);
        this.updateDebounceTimer.unref?.();
    }

    public async flush(): Promise<void> {
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
            this.updateDebounceTimer = undefined;
            await this.incrementalUpdate();
        }
    }

    private async incrementalUpdate(): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (this.pendingUpdates.size === 0) return;

        const filesToUpdate = Array.from(this.pendingUpdates);
        this.pendingUpdates.clear();

        for (const relativePath of filesToUpdate) {
            if (this.disposed) break;
            try {
                // Check if file still exists
                const fullPath = path.join(this.rootPath, relativePath);
                if (!this.fileSystem.existsSync?.(fullPath)) {
                    this.db.deleteFile(relativePath);
                    this.cache.delete(relativePath);
                    continue;
                }

                // Re-index this file only
                const content = this.fileSystem.readFileSync?.(fullPath) ?? await this.fileSystem.readFile(fullPath);
                const symbols = await this.extractSymbols(fullPath, content);
                this.cache.set(relativePath, { mtime: Date.now(), symbols });
                this.db.replaceSymbols({
                    relativePath,
                    lastModified: Date.now(),
                    language: null,
                    symbols
                });
            } catch (error) {
                console.error(`Failed to incrementally update ${relativePath}:`, error);
            }
        }
    }

    public getRecentlyModified(timeWindowMs: number): string[] {
        const cutoff = Date.now() - timeWindowMs;
        const result: string[] = [];
        for (const [filepath, timestamp] of this.editTracker.entries()) {
            if (timestamp > cutoff) {
                result.push(path.join(this.rootPath, filepath));
            }
        }
        return result;
    }

    public findSimilar(query: string, limit: number = 5): SymbolInfo[] {
        const results = this.fuzzySearch(query, { maxEditDistance: 2 });
        return results.slice(0, limit).map(r => r.symbol);
    }

    private createIgnoreFilter(patterns: string[]) {
        const filter = ignore.default().add(patterns);
        const defaults = ['.git', 'node_modules', '.mcp', '.kairo', 'dist', 'coverage', '.DS_Store'];
        const baseDir = PathManager.getBaseDir()
            .replace(/\\/g, "/")
            .replace(/\/+$/, "")
            .replace(/^\.\//, "");
        if (baseDir && !path.isAbsolute(baseDir)) {
            const root = baseDir.split("/")[0];
            if (root) {
                defaults.push(root);
            }
        }
        filter.add(Array.from(new Set(defaults)));
        return filter;
    }
}
