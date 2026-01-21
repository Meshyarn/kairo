import chokidar from 'chokidar';
import * as path from 'path';
import { SymbolIndex } from '../ast/SymbolIndex.js';
import { AstManager } from '../ast/AstManager.js';
import { DependencyGraph } from '../ast/DependencyGraph.js';
import { IndexDatabase } from './IndexDatabase.js';
import { ModuleResolver } from '../ast/ModuleResolver.js';
import { ConfigurationEvent, ConfigurationManager } from '../config/ConfigurationManager.js';
import { FeatureFlags } from '../config/FeatureFlags.js';
import { metrics } from "../utils/MetricsCollector.js";
import { PathManager } from "../utils/PathManager.js";
import { NodeFileSystem, type IFileSystem } from '../platform/FileSystem.js';
import { NativeSearchIndexer } from "../engine/search/native/NativeSearchIndexer.js";

import { ProjectIndexManager } from './ProjectIndexManager.js';
import type { ProjectIndex, FileIndexEntry } from './ProjectIndex.js';
import { UnifiedExtractor } from '../ast/extraction/UnifiedExtractor.js';
import { DocumentIndexer } from './DocumentIndexer.js';
import type { IndexingActivity } from './IndexStateManager.js';
import { hashContent } from '../utils/hash.js';

export interface IncrementalIndexerOptions {
    watch?: boolean;
    initialScan?: boolean;
    batchPauseMs?: number;
    statConcurrency?: number;
    fileSystem?: IFileSystem;
    onFileQueued?: (filePath: string) => void;
    onFileIndexed?: (filePath: string) => void;
    onFileRemoved?: (filePath: string) => void;
    onDirectoryRemoved?: (dirPath: string) => void;
    onActivity?: (activity?: IndexingActivity) => void;
    nativeSearchIndexer?: NativeSearchIndexer;
    repoId?: string;
}

const DEFAULT_BATCH_PAUSE_MS = 50;
const MAX_BATCH_PAUSE_MS = 500;
const IGNORE_FILE = '.gitignore';
const CONFIG_FILES = ['tsconfig.json', 'jsconfig.json', 'package.json'];
type PriorityLevel = 'high' | 'medium' | 'low';

export interface IndexerStatusSnapshot {
    queueDepth: { high: number; medium: number; low: number; total: number };
    currentPauseMs: number;
    maxQueueDepthSeen: number;
    processing: boolean;
    activity?: {
        label: string;
        detail?: string;
        startedAt: string;
    };
}

export class IncrementalIndexer {
    private readonly queues: Record<PriorityLevel, Map<string, number>> = {
        high: new Map(),
        medium: new Map(),
        low: new Map()
    };
    private processing = false;
    private processingPromise: Promise<void> | null = null;
    private watcher?: chokidar.FSWatcher;
    private stopped = false;
    private started = false;
    private initialScanPromise?: Promise<void>;
    private currentPauseMs = DEFAULT_BATCH_PAUSE_MS;
    private recentEventCount = 0;
    private lastEventBurst = 0;
    private maxQueueDepthSeen = 0;
    private lastDepthLogAt = 0;

    private moduleConfigReloadPromise?: Promise<void>;
    private astManagerReady?: Promise<void>;
    private configurationSubscriptions: Array<{ event: ConfigurationEvent; handler: (payload: any) => void }> = [];
    private configEventsRegistered = false;
    private activity?: { label: string; detail?: string; startedAt: number };

    private indexManager: ProjectIndexManager;
    private currentIndex: ProjectIndex | null = null;
    private astManager: AstManager;
    private unifiedExtractor: UnifiedExtractor;
    private extractorResolver: ModuleResolver;
    private documentIndexer?: DocumentIndexer;
    private pendingPersistence: Promise<void> | null = null;
    private baselineActive = false;
    private baselineScanCompleted = false;
    private baselineTotalFiles = 0;
    private baselineProcessedFiles = 0;
    private baselineStartedAt = 0;
    private baselineScanStartedAt = 0;
    private readonly fileSystem: IFileSystem;
    private readonly nativeSearchIndexer?: NativeSearchIndexer;
    private readonly repoId: string;

    constructor(
        private readonly rootPath: string,
        private readonly symbolIndex: SymbolIndex,
        private readonly dependencyGraph: DependencyGraph,
        private readonly indexDatabase?: IndexDatabase,
        private readonly moduleResolver?: ModuleResolver,
        private readonly configurationManager?: ConfigurationManager,
        private readonly options: IncrementalIndexerOptions = {},
        documentIndexer?: DocumentIndexer
    ) {
        this.fileSystem = options.fileSystem ?? new NodeFileSystem(rootPath);
        this.nativeSearchIndexer = options.nativeSearchIndexer;
        this.repoId = options.repoId ?? "default";
        this.indexManager = new ProjectIndexManager(rootPath, this.fileSystem);
        this.astManager = AstManager.getInstance();
        this.extractorResolver = moduleResolver ?? new ModuleResolver(rootPath);
        this.unifiedExtractor = new UnifiedExtractor(this.astManager.getQueryProvider(), {
            moduleResolver: this.extractorResolver
        });
        this.documentIndexer = documentIndexer;
    }

    public async start(): Promise<void> {
        if (this.started) {
            console.warn('[IncrementalIndexer] start() called while already running');
            return;
        }
        this.started = true;
        this.stopped = false;

        console.log('[IncrementalIndexer] Starting with persistent index support...');

        // 1. Try to load existing index
        this.currentIndex = await this.indexManager.loadPersistedIndex();

        if (this.currentIndex) {
            // Restore in-memory state
            await this.restoreFromPersistedIndex(this.currentIndex);
        } else {
            this.currentIndex = this.indexManager.createEmptyIndex();
        }

        // 2. Initial scan
        if (this.options.initialScan !== false) {
            this.initialScanPromise = this.enqueueInitialScan();
        }

        // 3. Start watcher
        if (this.options.watch !== false) {
            this.watcher = chokidar.watch(this.rootPath, {
                ignoreInitial: true,
                persistent: true,
                ignored: (watchedPath: string) => this.shouldIgnore(watchedPath),
                awaitWriteFinish: {
                    stabilityThreshold: 300,
                    pollInterval: 150
                },
                atomic: true
            });

            // Watch ignore file
            this.watcher.add(path.join(this.rootPath, IGNORE_FILE));

            // Watch config files
            for (const file of CONFIG_FILES) {
                this.watcher.add(path.join(this.rootPath, file));
            }

            this.watcher.on('add', file => this.enqueuePath(file, 'medium'));
            this.watcher.on('change', file => void this.handleFileChange(file));
            this.watcher.on('unlink', file => this.handleDeletion(file));
            this.watcher.on('unlinkDir', dir => this.handleDirectoryDeletion(dir));
            this.watcher.on('error', error => {
                console.warn('[IncrementalIndexer] watcher error', error);
            });
        }

        this.registerConfigurationEvents();
        this.startPeriodicPersistence();
    }

    private periodicPersistenceTimer?: NodeJS.Timeout;

        public async stop(): Promise<void> {
        console.log('[IncrementalIndexer] Stop called');
        this.stopped = true;
        this.started = false;

        this.unregisterConfigurationEvents();

        if (this.periodicPersistenceTimer) {
            console.log('[IncrementalIndexer] Clearing persistence timer');
            clearInterval(this.periodicPersistenceTimer);
        }

        // Wait for current processing batch to complete
        if (this.processingPromise) {
            console.log('[IncrementalIndexer] Waiting for processingPromise to resolve...');
            await this.processingPromise;
            console.log('[IncrementalIndexer] processingPromise resolved');
        }

        if (this.debouncedPersist) {
            console.log('[IncrementalIndexer] Cancelling debounced persist');
            this.debouncedPersist.cancel();
        }

        // Final persist before stop
        await this.persistNow(true);

        if (this.watcher) {
            console.log('[IncrementalIndexer] Closing watcher');
            await this.watcher.close();
        }

        if (this.indexDatabase && typeof this.indexDatabase.close === 'function') {
            console.log('[IncrementalIndexer] Closing database');
            this.indexDatabase.close();
        }
        console.log('[IncrementalIndexer] Stop complete');
    }


    public async waitForInitialScan(): Promise<void> {
        if (this.initialScanPromise) {
            await this.initialScanPromise;
        }
        await this.waitForIdle();
        this.nativeSearchIndexer?.flush();
    }

    public async reindexAll(): Promise<void> {
        if (this.initialScanPromise) {
            await this.initialScanPromise;
        }
        if (this.processingPromise) {
            await this.processingPromise;
        }
        this.clearQueues();
        this.currentIndex = this.indexManager.createEmptyIndex();
        await this.persistNow(true);
        this.initialScanPromise = this.enqueueInitialScan();
        await this.initialScanPromise;
        await this.waitForIdle();
        this.nativeSearchIndexer?.flush();
    }

    public async waitForIdle(timeoutMs?: number): Promise<boolean> {
        const start = Date.now();
        const timeout = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : undefined;
        while (!this.stopped) {
            if (!this.processing && this.getTotalQueueSize() === 0) {
                return true;
            }
            if (timeout && Date.now() - start > timeout) {
                return false;
            }
            await this.sleep(50);
        }
        return false;
    }

    public getQueueStats(): { currentDepth: number; maxDepthSeen: number; currentPauseMs: number } {
        const depth = this.getQueueDepth();
        return {
            currentDepth: depth.total,
            maxDepthSeen: this.maxQueueDepthSeen,
            currentPauseMs: this.currentPauseMs
        };
    }

    public getActivitySnapshot(): IndexerStatusSnapshot {
        const depth = this.getQueueDepth();
        return {
            queueDepth: depth,
            currentPauseMs: this.currentPauseMs,
            maxQueueDepthSeen: this.maxQueueDepthSeen,
            processing: this.processing,
            activity: this.activity ? {
                label: this.activity.label,
                detail: this.activity.detail,
                startedAt: new Date(this.activity.startedAt).toISOString()
            } : undefined
        };
    }

    public enqueuePaths(filePaths: string[] | string, priority: PriorityLevel = 'high'): number {
        const list = Array.isArray(filePaths) ? filePaths : [filePaths];
        if (list.length === 0) return 0;
        for (const filePath of list) {
            this.enqueuePath(filePath, priority);
        }
        return list.length;
    }

    public async notifyDeletion(filePath: string): Promise<void> {
        await this.handleDeletion(filePath);
    }

    private enqueuePath(filePath: string, priority: PriorityLevel = 'medium') {
        if (!this.isWithinRoot(filePath)) return;
        const isCode = this.symbolIndex.isSupported(filePath);
        const isDoc = this.isDocumentFile(filePath);
        if (!isCode && !isDoc) return;

        if (isDoc && !isCode) {
            const normalized = path.resolve(filePath);
            let finalPath = normalized;
            try {
                finalPath = this.fileSystem.realpathSync?.(normalized) ?? normalized;
            } catch {
                // Ignore if path doesn't exist
            }
            this.options.onFileQueued?.(finalPath);
            void this.documentIndexer?.indexFile(filePath).then(() => {
                this.options.onFileIndexed?.(finalPath);
            });
            return;
        }

        const normalized = path.resolve(filePath);
        let finalPath = normalized;
        try {
            finalPath = this.fileSystem.realpathSync?.(normalized) ?? normalized;
        } catch {
            // Ignore if path doesn't exist
        }

        this.options.onFileQueued?.(finalPath);

        const now = Date.now();
        const burstLimit = 1000; // 1 second
        if (now - this.lastEventBurst < burstLimit) {
            this.recentEventCount++;
        } else {
            this.recentEventCount = 1;
            this.lastEventBurst = now;
        }

        // Adaptive pacing based on event frequency
        if (this.recentEventCount > 50) {
            this.currentPauseMs = Math.min(this.currentPauseMs * 1.5, MAX_BATCH_PAUSE_MS);
        } else if (this.recentEventCount < 10) {
            this.currentPauseMs = Math.max(DEFAULT_BATCH_PAUSE_MS, this.currentPauseMs / 1.5);
        }

        this.removeFromQueues(finalPath);
        this.queues[priority].set(finalPath, now);

        const totalDepth = this.getTotalQueueSize();
        this.maxQueueDepthSeen = Math.max(this.maxQueueDepthSeen, totalDepth);

        metrics.inc("indexer.events");
        metrics.gauge("indexer.queue_depth", totalDepth);
        metrics.gauge("indexer.pause_ms", this.currentPauseMs);

        if (totalDepth > 100 && (now - this.lastDepthLogAt > 5000)) {
            console.info(`[IncrementalIndexer] High queue depth: ${totalDepth} (pause=${this.currentPauseMs}ms)`);
            this.lastDepthLogAt = now;
        }

                if (!this.processingPromise) {
            this.processingPromise = this.processQueue().finally(() => {
                this.processingPromise = null;
            });
        }

    }

    private async processQueue(): Promise<void> {
        if (this.processing || this.stopped) return;
        this.processing = true;

        while (this.getTotalQueueSize() > 0 && !this.stopped) {
            const batchDelay = Math.max(this.options.batchPauseMs ?? this.currentPauseMs, 50);
            await this.sleep(batchDelay);
            this.setActivity('queue_processing', `Processing ${this.getTotalQueueSize()} queued files`);

            const batchEntries = this.pullNextBatch();
            
            // Phase 1 (ADR-029): Parallel processing within batch
            const PARALLEL_LIMIT = 8;
            for (let i = 0; i < batchEntries.length; i += PARALLEL_LIMIT) {
                const chunk = batchEntries.slice(i, i + PARALLEL_LIMIT);
                await Promise.all(chunk.map(async (filePath) => {
                    if (this.stopped) {
                        return;
                    }
                    if (!(await this.fileExists(filePath))) {
                        return;
                    }
                    const isDocFile = this.isDocumentFile(filePath);

                    const stopBaselineIndex = this.baselineActive ? metrics.startTimer("baseline.index_ms") : null;
                    try {
                        if (isDocFile && this.documentIndexer) {
                            await this.documentIndexer.indexFile(filePath, { force: true });
                            if (this.currentIndex && !this.stopped) {
                                const stat = await this.fileSystem.stat(filePath).catch(() => undefined);
                                if (stat) {
                                    const entry: FileIndexEntry = {
                                        mtime: stat.mtime,
                                        symbols: [],
                                        imports: [],
                                        exports: [],
                                        trigrams: {
                                            wordCount: 0,
                                            uniqueTrigramCount: 0
                                        }
                                    };
                                    this.indexManager.updateFileEntry(this.currentIndex, filePath, entry);
                                }
                            }
                            this.options.onFileIndexed?.(filePath);
                            if (this.baselineActive) {
                                this.baselineProcessedFiles += 1;
                                this.updateBaselineActivity("indexing");
                            }
                            return;
                        }
                        const symbols = await this.symbolIndex.getSymbolsForFile(filePath);
                        const content = await this.fileSystem.readFile(filePath);
                        const languageId = this.astManager.getLanguageId(filePath);
                        let doc: any;
                        try {
                            const unifiedEnabled = FeatureFlags.isEnabled(FeatureFlags.UNIFIED_EXTRACTION_ENABLED, FeatureFlags.getContext());
                            const shouldParseDoc = !unifiedEnabled || !this.unifiedExtractor.supportsRegex(languageId);
                            if (shouldParseDoc) {
                                await this.ensureAstManagerReady();
                                doc = await this.astManager.parseFile(filePath, content);
                            }
                            const [imports, exports] = await Promise.all([
                                this.unifiedExtractor.extractImports(filePath, content, languageId, { doc }),
                                this.unifiedExtractor.extractExports(filePath, content, languageId, { doc })
                            ]);

                            await this.dependencyGraph.updateFileDependencies(filePath);

                            // Update persistent index
                            if (this.currentIndex && !this.stopped) {
                                const stat = await this.fileSystem.stat(filePath).catch(() => undefined);
                                if (stat) {
                                    const contentHash = hashContent(content);
                                    const callgraphRank = await this.resolveCallgraphRank(filePath);
                                    const entry: FileIndexEntry = {
                                        mtime: stat.mtime,
                                        symbols,
                                        imports,
                                        exports,
                                        trigrams: {
                                            wordCount: 0,
                                            uniqueTrigramCount: 0
                                        }
                                    };
                                    this.indexManager.updateFileEntry(this.currentIndex, filePath, entry);
                                    if (this.indexDatabase) {
                                        const relPath = path.relative(this.rootPath, filePath);
                                        this.indexDatabase.updateFileMeta(relPath, {
                                            lastModified: stat.mtime,
                                            contentHash,
                                            sizeBytes: stat.size
                                        });
                                    }
                                    if (this.nativeSearchIndexer) {
                                        const relPath = path.relative(this.rootPath, filePath).replace(/\\/g, "/");
                                        this.nativeSearchIndexer.upsertCodeFile({
                                            repoId: this.repoId,
                                            filePath: relPath,
                                            content,
                                            contentHash,
                                            mtimeMs: stat.mtime,
                                            symbols,
                                            callgraphRank
                                        });
                                    }
                                }
                            }
                        } finally {
                            doc?.dispose?.();
                        }
                        this.options.onFileIndexed?.(filePath);
                        if (this.baselineActive) {
                            this.baselineProcessedFiles += 1;
                            this.updateBaselineActivity("indexing");
                        }
                    } catch (error) {
                        console.warn(`[IncrementalIndexer] failed to index ${filePath}:`, error);
                    } finally {
                        if (stopBaselineIndex) stopBaselineIndex();
                    }
                }));
            }
            
            this.debouncedPersist();
        }

        this.clearActivity('queue_processing');
        if (this.baselineActive && this.baselineScanCompleted && this.getTotalQueueSize() === 0) {
            this.baselineActive = false;
            this.baselineStartedAt = 0;
            this.baselineScanCompleted = false;
            this.baselineTotalFiles = 0;
            this.baselineProcessedFiles = 0;
            this.setActivity("baseline_complete");
            this.clearActivity("baseline_complete");
        }
        this.processing = false;
    }

    private async enqueueInitialScan(): Promise<void> {
        this.baselineActive = true;
        this.baselineScanCompleted = false;
        this.baselineTotalFiles = 0;
        this.baselineProcessedFiles = 0;
        this.baselineStartedAt = Date.now();
        this.baselineScanStartedAt = Date.now();
        this.updateBaselineActivity("scanning");
        const stopInitialScan = metrics.startTimer("indexer.initial_scan_ms");
        const stopBaselineScan = metrics.startTimer("baseline.scan_ms");
        const stack: string[] = [this.rootPath];
        const batchSize = this.resolveScanBatchSize();
        const batchCounter = { count: 0 };
        const maxMsPerTick = this.resolveBaselineMaxMsPerTick();
        const maxFilesPerTick = this.resolveBaselineMaxFilesPerTick();
        
        try {
            while (stack.length > 0 && !this.stopped) {
                const tickStart = Date.now();
                let tickFiles = 0;
                const current = stack.pop()!;
                let entries: string[];
                try {
                    entries = await this.fileSystem.readDir(current);
                } catch {
                    continue;
                }

                const supportedFiles: string[] = [];
                for (const entry of entries) {
                    const fullPath = path.join(current, entry);
                    if (this.shouldIgnore(fullPath)) continue;

                    try {
                        const stat = await this.fileSystem.stat(fullPath);
                        if (stat.isDirectory()) {
                            stack.push(fullPath);
                        } else if (this.symbolIndex.isSupported(fullPath) || this.isDocumentFile(fullPath)) {
                            supportedFiles.push(fullPath);
                            this.baselineTotalFiles += 1;
                        }
                    } catch {
                        // ignore missing/stat failures
                    }
                    batchCounter.count += 1;
                    tickFiles += 1;
                    await this.yieldIfNeeded(batchCounter, batchSize);
                    if (tickFiles >= maxFilesPerTick || (Date.now() - tickStart) >= maxMsPerTick) {
                        this.updateBaselineActivity("scanning");
                        await this.sleep(0);
                        tickFiles = 0;
                    }
                }

                // Phase 1 (ADR-029): Parallel check for reindexing
                const filesToIndex = await this.batchShouldReindex(supportedFiles);
                for (const filePath of filesToIndex) {
                    this.enqueuePath(filePath, 'low');
                }

                // Yield control back to event loop periodically
                await this.sleep(0);
            }
        } finally {
            stopInitialScan();
            stopBaselineScan();
            this.baselineScanCompleted = true;
            this.updateBaselineActivity("indexing");
        }
    }

    private async ensureAstManagerReady(): Promise<void> {
        if (!this.astManagerReady) {
            const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
            this.astManagerReady = this.astManager.init({ mode: isTestEnv ? 'test' : 'prod', rootPath: this.rootPath });
        }
        await this.astManagerReady;
    }

    private async handleFileChange(filePath: string): Promise<void> {
        const basename = path.basename(filePath);
        
        // If ignore file changed, we might need a full re-scan or at least re-evaluate current index
        if (basename === IGNORE_FILE) {
            await this.handleIgnoreChange();
            return;
        }

        if (CONFIG_FILES.includes(basename)) {
            await this.handleModuleConfigChange(filePath);
        }

        this.enqueuePath(filePath, 'medium');
    }

    private async handleIgnoreChange(): Promise<void> {
        try {
            if (!this.indexDatabase) {
                console.warn('[IncrementalIndexer] IndexDatabase not provided; skipping gitignore reindex');
                return;
            }

            console.info('[IncrementalIndexer] Detected .gitignore change; re-evaluating indexed files...');
            this.setActivity('gitignore_reindex', 'Re-evaluating ignore rules');

            const indexedFiles = this.indexDatabase.listFiles();
            const filesToRemove: string[] = [];
            const batchSize = this.resolveIgnoreScanBatchSize();
            const batchCounter = { count: 0 };

            for (const fileRecord of indexedFiles) {
                const absolutePath = path.join(this.rootPath, fileRecord.path);
                if (this.shouldIgnore(absolutePath)) {
                    filesToRemove.push(fileRecord.path);
                }
                batchCounter.count += 1;
                await this.yieldIfNeeded(batchCounter, batchSize);
            }

            for (const relPath of filesToRemove) {
                try {
                    this.indexDatabase.deleteFile(relPath);
                    console.debug(`[IncrementalIndexer] Removed ignored file from index: ${relPath}`);
                } catch (error) {
                    console.warn(`[IncrementalIndexer] Failed to remove ${relPath} from index:`, error);
                }
            }

            const newFiles = await this.scanForNewFiles();
            for (const filePath of newFiles) {
                this.enqueuePath(filePath, 'high');
            }

            console.info(`[IncrementalIndexer] Gitignore reindex: removed ${filesToRemove.length} files, enqueued ${newFiles.length} new files`);
        } catch (error) {
            console.error('[IncrementalIndexer] Error handling .gitignore change:', error);
        } finally {
            this.clearActivity('gitignore_reindex');
        }
    }

    private async scanForNewFiles(): Promise<string[]> {
        const stopIncremental = metrics.startTimer("indexer.incremental_scan_ms");
        const newFiles: string[] = [];
        const stack: string[] = [this.rootPath];
        const batchSize = this.resolveScanBatchSize();
        const batchCounter = { count: 0 };

        try {
            while (stack.length > 0 && !this.stopped) {
                const current = stack.pop()!;
                let entries: string[];
                try {
                    entries = await this.fileSystem.readDir(current);
                } catch {
                    continue;
                }

                for (const entry of entries) {
                    const fullPath = path.join(current, entry);
                    if (this.shouldIgnore(fullPath)) continue;

                    try {
                        const stat = await this.fileSystem.stat(fullPath);
                        if (stat.isDirectory()) {
                            stack.push(fullPath);
                        } else if (this.symbolIndex.isSupported(fullPath) || this.isDocumentFile(fullPath)) {
                            // Check if already in index
                            const relPath = path.relative(this.rootPath, fullPath);
                            const existing = this.indexDatabase?.getFile(relPath);
                            if (!existing) {
                                newFiles.push(fullPath);
                            }
                        }
                    } catch {
                        // ignore
                    }
                    batchCounter.count += 1;
                    await this.yieldIfNeeded(batchCounter, batchSize);
                }
                await this.sleep(0);
            }
            return newFiles;
        } finally {
            stopIncremental();
        }
    }

    private resolveScanBatchSize(): number {
        const raw = Number(process.env.KAIRO_INDEX_SCAN_BATCH_SIZE ?? "");
        const candidate = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
        return Math.max(50, candidate);
    }

    private resolveIgnoreScanBatchSize(): number {
        const raw = Number(process.env.KAIRO_INDEX_IGNORE_BATCH_SIZE ?? "");
        const candidate = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 500;
        return Math.max(100, candidate);
    }

    private async yieldIfNeeded(counter: { count: number }, batchSize: number): Promise<void> {
        if (counter.count < batchSize) return;
        counter.count = 0;
        await this.sleep(0);
    }

    private registerConfigurationEvents(): void {
        if (!this.configurationManager || this.configEventsRegistered) return;

        const ignoreHandler = () => void this.handleIgnoreChange();
        const tsconfigHandler = (payload: { filePath: string }) => void this.handleModuleConfigChange(payload.filePath);
        const packageHandler = (payload: { filePath: string }) => void this.handleModuleConfigChange(payload.filePath);

        this.configurationManager.on("ignoreChanged", ignoreHandler);
        this.configurationSubscriptions.push({ event: "ignoreChanged", handler: ignoreHandler });

        this.configurationManager.on("tsconfigChanged", tsconfigHandler);
        this.configurationSubscriptions.push({ event: "tsconfigChanged", handler: tsconfigHandler });

        this.configurationManager.on("jsconfigChanged", tsconfigHandler);
        this.configurationSubscriptions.push({ event: "jsconfigChanged", handler: tsconfigHandler });

        this.configurationManager.on("packageJsonChanged", packageHandler);
        this.configurationSubscriptions.push({ event: "packageJsonChanged", handler: packageHandler });

        this.configEventsRegistered = true;
    }

    private unregisterConfigurationEvents(): void {
        if (!this.configurationManager) return;
        for (const subscription of this.configurationSubscriptions) {
            this.configurationManager.off(subscription.event as ConfigurationEvent, subscription.handler);
        }
        this.configurationSubscriptions = [];
        this.configEventsRegistered = false;
    }

    private async handleModuleConfigChange(filePath: string): Promise<void> {
        if (!this.moduleResolver) {
            console.warn('[IncrementalIndexer] ModuleResolver not provided; skipping config reload');
            return;
        }

        // Debounce config reload
        if (this.moduleConfigReloadPromise) return;
        this.moduleConfigReloadPromise = this.performModuleConfigReload(filePath).finally(() => {
            this.moduleConfigReloadPromise = undefined;
        });
    }

    private async performModuleConfigReload(filePath: string): Promise<void> {
        const basename = path.basename(filePath);
        console.info(`[IncrementalIndexer] Detected configuration change (${basename}); reloading module resolver and rebuilding unresolved dependencies...`);
        this.setActivity('config_reload', `Reloading configuration from ${basename}`);
        try {
            this.moduleResolver!.reloadConfig();
            await this.dependencyGraph.rebuildUnresolved();
            console.info('[IncrementalIndexer] Configuration reload complete.');
        } catch (error) {
            console.error('[IncrementalIndexer] Error handling configuration change:', error);
        } finally {
            this.clearActivity('config_reload');
        }
    }

    private async handleDeletion(filePath: string): Promise<void> {
        try {
                        if (!this.isWithinRoot(filePath)) return;
            const absolutePath = path.resolve(filePath);
            this.removeFromQueues(absolutePath);

            if (this.isDocumentFile(filePath)) {
                this.documentIndexer?.deleteFile(filePath);
            }
            if (this.symbolIndex.isSupported(filePath)) {
                const relativePath = path.relative(this.rootPath, absolutePath).replace(/\\\\/g, "/");
                this.nativeSearchIndexer?.deleteCodeFile(this.repoId, relativePath);
            }

            // Tier 3: Ghost Archeology - Register symbols from deleted file as ghosts
            if (this.indexDatabase) {
                const relativePath = path.relative(this.rootPath, absolutePath).replace(/\\\\/g, '/');
                const symbols = this.indexDatabase.readSymbols(relativePath);
                if (symbols && symbols.length > 0) {
                    for (const symbol of symbols) {
                        this.indexDatabase.addGhost({
                            name: symbol.name,
                            lastSeenPath: relativePath,
                            type: symbol.type,
                            lastKnownSignature: 'signature' in symbol ? symbol.signature : undefined,
                            deletedAt: Date.now()
                        });
                    }
                }
            }

            await this.dependencyGraph.removeFile(filePath);

            if (this.currentIndex) {
                this.indexManager.removeFileEntry(this.currentIndex, filePath);
                this.debouncedPersist();
            }

            this.options.onFileRemoved?.(absolutePath);
        } catch (error) {
            console.warn(`[IncrementalIndexer] failed to remove ${filePath}:`, error);
        }
    }

    private async handleDirectoryDeletion(dirPath: string): Promise<void> {
        try {
            if (!this.isWithinRoot(dirPath)) return;
            const normalizedDir = path.resolve(dirPath);
            this.removeMatchingFromQueues(queued => queued.startsWith(normalizedDir));

            await this.dependencyGraph.removeDirectory(dirPath);
            this.options.onDirectoryRemoved?.(normalizedDir);
        } catch (error) {
            console.warn(`[IncrementalIndexer] failed to remove directory ${dirPath}:`, error);
        }
    }

    private isDocumentFile(filePath: string): boolean {
        return this.documentIndexer?.isSupported(filePath) ?? false;
    }

    private shouldIgnore(absolutePath: string): boolean {
        if (!this.isWithinRoot(absolutePath)) return true;
        const relative = path.relative(this.rootPath, absolutePath);
        
        // HardcodedMCP ignore
        const normalized = relative.split(path.sep).join('/');
        const ignoredRoots = ['.mcp', '.kairo', '.kairo-index'];
        if (ignoredRoots.some(root => normalized === root || normalized.startsWith(`${root}/`))) {
            return true;
        }

        return this.symbolIndex.shouldIgnore(relative);
    }

    private isWithinRoot(filePath: string): boolean {
        const normalized = path.resolve(filePath);
        return normalized.startsWith(this.rootPath);
    }

    private async fileExists(filePath: string): Promise<boolean> {
        return this.fileSystem.exists(filePath);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private pullNextBatch(): string[] {
        let entries: string[] = [];
        
        entries = entries.concat(this.flushQueue('high'));
        if (entries.length >= 50) return entries;

        entries = entries.concat(this.flushQueue('medium'));
        if (entries.length >= 100) return entries;

        entries = entries.concat(this.flushQueue('low'));
        return entries;
    }

    private flushQueue(priority: PriorityLevel): string[] {
        const queue = this.queues[priority];
        const entries = Array.from(queue.keys());
        queue.clear();
        return entries;
    }

    private clearQueues(): void {
        this.queues.high.clear();
        this.queues.medium.clear();
        this.queues.low.clear();
    }

    private getTotalQueueSize(): number {
        return this.queues.high.size + this.queues.medium.size + this.queues.low.size;
    }

    private getQueueDepth() {
        const high = this.queues.high.size;
        const medium = this.queues.medium.size;
        const low = this.queues.low.size;
        return { high, medium, low, total: high + medium + low };
    }

    private removeFromQueues(filePath: string): void {
        for (const queue of Object.values(this.queues)) {
            queue.delete(filePath);
        }
    }

    private removeMatchingFromQueues(predicate: (path: string) => boolean): void {
        for (const queue of Object.values(this.queues)) {
            for (const key of Array.from(queue.keys())) {
                if (predicate(key)) {
                    queue.delete(key);
                }
            }
        }
    }

    private setActivity(label: string, detail?: string): void {
        this.activity = { label, detail, startedAt: Date.now() };
    }

    private clearActivity(label?: string): void {
        if (!label || (this.activity && this.activity.label === label)) {
            this.activity = undefined;
        }
    }

    private updateBaselineActivity(phase: "scanning" | "indexing"): void {
        if (!this.baselineActive) return;
        const processed = phase === "scanning" ? this.baselineTotalFiles : this.baselineProcessedFiles;
        const total = Math.max(this.baselineTotalFiles, 1);
        const elapsedMs = Math.max(1, Date.now() - this.baselineStartedAt);
        const rate = this.baselineProcessedFiles > 0 ? this.baselineProcessedFiles / elapsedMs : 0;
        const remaining = Math.max(0, this.baselineTotalFiles - this.baselineProcessedFiles);
        const eta = rate > 0 ? Math.round(remaining / rate) : undefined;
        const activity: IndexingActivity = {
            phase,
            processed,
            total,
            ...(eta ? { eta } : {})
        };
        this.indexerActivityGauge(remaining, total);
        this.options.onActivity?.(activity);
    }

    private indexerActivityGauge(remaining: number, total: number): void {
        metrics.gauge("baseline.pending_files", remaining);
        const ratio = total > 0 ? (total - remaining) / total : 0;
        metrics.gauge("baseline.progress_ratio", ratio);
    }

    private resolveBaselineMaxMsPerTick(): number {
        const raw = Number.parseInt(process.env.KAIRO_BASELINE_MAX_MS_PER_TICK ?? "25", 10);
        if (Number.isFinite(raw) && raw > 0) return raw;
        return 25;
    }

    private resolveBaselineMaxFilesPerTick(): number {
        const raw = Number.parseInt(process.env.KAIRO_BASELINE_MAX_FILES_PER_TICK ?? "50", 10);
        if (Number.isFinite(raw) && raw > 0) return raw;
        return 50;
    }

    private async resolveCallgraphRank(filePath: string): Promise<number> {
        try {
            const incoming = await this.dependencyGraph.getDependencies(filePath, "upstream");
            const outgoing = await this.dependencyGraph.getDependencies(filePath, "downstream");
            const total = incoming.length + outgoing.length;
            if (total <= 0) return 0;
            return Math.min(1, Math.log1p(total) / 4);
        } catch {
            return 0;
        }
    }

    private async batchShouldReindex(files: string[]): Promise<string[]> {
        const concurrency = this.resolveStatConcurrency();
        const results: string[] = [];
        let index = 0;

        const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
            while (!this.stopped) {
                const file = files[index];
                index += 1;
                if (!file) break;
                if (await this.shouldReindex(file)) {
                    results.push(file);
                }
            }
        });

        await Promise.all(workers);
        return results;
    }

    private async shouldReindex(filePath: string): Promise<boolean> {
        if (!this.currentIndex) return true;

        const normalized = path.resolve(filePath);
        let entry: FileIndexEntry | undefined = this.currentIndex.files[normalized];
        if (!entry) {
            try {
                const resolved = await this.fileSystem.realpath(normalized);
                entry = this.currentIndex.files[resolved];
            } catch {
                entry = undefined;
            }
        }
        if (!entry) return true; // New file

        try {
            const stat = await this.fileSystem.stat(filePath);
            return stat.mtime > entry.mtime; // Changed if mtime newer
        } catch {
            return true; // Stat failed → reindex to be safe
        }
    }

    private async restoreFromPersistedIndex(index: ProjectIndex): Promise<void> {
        console.log(`[IncrementalIndexer] Restoring from persisted index (${Object.keys(index.files).length} files)...`);

        const restorePromises = Object.entries(index.files).map(([filePath, entry]) => {
            const resolvedEdges = entry.imports
                ?.filter(imp => !!imp.resolvedPath)
                .map(imp => ({
                    from: filePath,
                    to: imp.resolvedPath!,
                    type: 'import' as const,
                    what: imp.what.join(', '),
                    line: imp.line
                })) ?? [];

            return Promise.all([
                Promise.resolve(this.symbolIndex.restoreFromCache(filePath, entry.symbols, entry.mtime)),
                resolvedEdges.length > 0
                    ? this.dependencyGraph.restoreEdges(filePath, resolvedEdges)
                    : Promise.resolve()
            ]);
        });

        await Promise.all(restorePromises);

        console.log('[IncrementalIndexer] Restore complete');
    }

    private debouncedPersist = debounce(async () => {
        await this.persistNow();
    }, 5000); // Wait 5 seconds after last change

    private async persistNow(isFinal = false): Promise<void> {
        if (!this.currentIndex) return;
        if (this.stopped && !isFinal) return;
        if (this.pendingPersistence) return this.pendingPersistence;

        this.pendingPersistence = this.indexManager.persistIndex(this.currentIndex).finally(() => {
            this.pendingPersistence = null;
        });
        return this.pendingPersistence;
    }

    private resolveStatConcurrency(): number {
        const optionValue = typeof this.options.statConcurrency === "number"
            ? this.options.statConcurrency
            : undefined;
        const envValue = Number(process.env.KAIRO_INDEX_STAT_CONCURRENCY ?? "");
        const candidate = Number.isFinite(optionValue) && optionValue! > 0
            ? optionValue!
            : (Number.isFinite(envValue) && envValue > 0 ? envValue : 32);
        return Math.max(4, Math.min(128, Math.floor(candidate)));
    }

    private startPeriodicPersistence(): void {
        // Wait 5 seconds after last change
        if (this.periodicPersistenceTimer) {
            clearInterval(this.periodicPersistenceTimer);
        }
        this.periodicPersistenceTimer = setInterval(async () => {
            await this.persistNow();
        }, 5 * 60 * 1000);
        this.periodicPersistenceTimer.unref?.();
    }
}

interface DebouncedFunction<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): void;
    cancel: () => void;
}

function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): DebouncedFunction<T> {
    let timeout: NodeJS.Timeout | null = null;

    const debounced = (...args: Parameters<T>) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
        timeout.unref?.();
    };

    debounced.cancel = () => {
        if (timeout) clearTimeout(timeout);
    };

    return debounced;
}
