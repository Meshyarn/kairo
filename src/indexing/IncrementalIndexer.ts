import type { FSWatcher } from 'chokidar';
import * as path from 'path';
import { SymbolIndex } from '../ast/SymbolIndex.js';
import { AstManager } from '../ast/AstManager.js';
import { DependencyGraph } from '../ast/DependencyGraph.js';
import { IndexDatabase } from './IndexDatabase.js';
import { ModuleResolver } from '../ast/ModuleResolver.js';
import { ConfigurationManager } from '../config/ConfigurationManager.js';
import { NodeFileSystem, type IFileSystem } from '../platform/FileSystem.js';
import { NativeSearchIndexer } from "../engine/search/native/NativeSearchIndexer.js";

import { ProjectIndexManager } from './ProjectIndexManager.js';
import type { ProjectIndex } from './ProjectIndex.js';
import { UnifiedExtractor } from '../ast/extraction/UnifiedExtractor.js';
import { DocumentIndexer } from './DocumentIndexer.js';
import type { IncrementalIndexerOptions, IndexerStatusSnapshot } from './IncrementalIndexerTypes.js';
import { processQueue } from "./incremental/IncrementalIndexerQueue.js";
import { enqueueInitialScan } from "./incremental/IncrementalIndexerScan.js";
import { createQueueState, getQueueDepth, getTotalQueueSize, pullNextBatch, clearQueues, removeFromQueues, removeMatchingFromQueues, type PriorityLevel } from "./incremental/IncrementalIndexerQueueState.js";
import { enqueuePath as enqueuePathInternal, type QueueMetricsState } from "./incremental/IncrementalIndexerEnqueue.js";
import { registerConfigurationEvents, unregisterConfigurationEvents, type ConfigurationSubscription } from "./incremental/IncrementalIndexerConfigEvents.js";
import { handleModuleConfigChange as handleModuleConfigChangeInternal } from "./incremental/IncrementalIndexerConfigReload.js";
import { updateBaselineActivity, resolveBaselineMaxFilesPerTick, resolveBaselineMaxMsPerTick } from "./incremental/IncrementalIndexerBaseline.js";
import { batchShouldReindex, resolveStatConcurrency, shouldReindex } from "./incremental/IncrementalIndexerReindex.js";
import { createDebouncedPersist, persistNow as persistNowInternal, startPeriodicPersistence as startPeriodicPersistenceInternal, type DebouncedFunction } from "./incremental/IncrementalIndexerPersistence.js";
import { restoreFromPersistedIndex } from "./incremental/IncrementalIndexerRestore.js";
import { shouldIgnorePath } from "./incremental/IncrementalIndexerIgnore.js";
import { startIncrementalIndexer, stopIncrementalIndexer } from "./incremental/IncrementalIndexerLifecycle.js";
import { waitForIdle, waitForInitialScan, reindexAll as reindexAllOperation } from "./incremental/IncrementalIndexerOperations.js";
import { handleFileChangeEvent, handleIgnoreChangeEvent } from "./incremental/IncrementalIndexerFileEvents.js";
import { runInitialScan } from "./incremental/IncrementalIndexerInitialScan.js";
import { resolveScanBatchSize, resolveIgnoreScanBatchSize } from "./incremental/IncrementalIndexerScanConfig.js";
import { resolveCallgraphRank } from "./incremental/IncrementalIndexerRank.js";
import { handleFileDeletionFlow, handleDirectoryDeletionFlow } from "./incremental/IncrementalIndexerDeletionFlow.js";
import { getQueueStats as getQueueStatsSnapshot, getActivitySnapshot as getActivitySnapshotSnapshot } from "./incremental/IncrementalIndexerStatus.js";

const DEFAULT_BATCH_PAUSE_MS = 50;
const MAX_BATCH_PAUSE_MS = 500;
const IGNORE_FILE = '.gitignore';
const CONFIG_FILES = ['tsconfig.json', 'jsconfig.json', 'package.json'];

export class IncrementalIndexer {
    private readonly queues = createQueueState();
    private readonly queueMetrics: QueueMetricsState = {
        recentEventCount: 0,
        lastEventBurst: 0,
        currentPauseMs: DEFAULT_BATCH_PAUSE_MS,
        maxQueueDepthSeen: 0,
        lastDepthLogAt: 0
    };
    private processing = false;
    private processingPromise: Promise<void> | null = null;
    private watcher?: FSWatcher;
    private stopped = false;
    private started = false;
    private initialScanPromise?: Promise<void>;

    private moduleConfigReloadPromise?: Promise<void>;
    private astManagerReady?: Promise<void>;
    private configurationSubscriptions: ConfigurationSubscription[] = [];
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
    private debouncedPersist: DebouncedFunction<() => void> = createDebouncedPersist(() => this.persistNow());

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
        await startIncrementalIndexer({
            rootPath: this.rootPath,
            started: this.started,
            setStarted: (value) => { this.started = value; },
            setStopped: (value) => { this.stopped = value; },
            indexManager: this.indexManager,
            setCurrentIndex: (index) => { this.currentIndex = index; },
            restoreFromPersistedIndex: (index) => restoreFromPersistedIndex({
                index,
                symbolIndex: this.symbolIndex,
                dependencyGraph: this.dependencyGraph
            }),
            options: this.options,
            enqueueInitialScan: () => this.enqueueInitialScan(),
            setInitialScanPromise: (promise) => { this.initialScanPromise = promise; },
            shouldIgnore: (watchedPath) => this.shouldIgnore(watchedPath),
            enqueuePath: (filePath, priority) => this.enqueuePath(filePath, priority),
            handleFileChange: (filePath) => this.handleFileChange(filePath),
            handleDeletion: (filePath) => this.handleDeletion(filePath),
            handleDirectoryDeletion: (dirPath) => this.handleDirectoryDeletion(dirPath),
            registerConfigurationEvents: () => this.registerConfigurationEvents(),
            startPeriodicPersistence: () => this.startPeriodicPersistence(),
            setWatcher: (watcher) => { this.watcher = watcher; }
        });
    }

    private periodicPersistenceTimer?: NodeJS.Timeout;

    public async stop(): Promise<void> {
        await stopIncrementalIndexer({
            setStopped: (value) => { this.stopped = value; },
            setStarted: (value) => { this.started = value; },
            unregisterConfigurationEvents: () => this.unregisterConfigurationEvents(),
            periodicPersistenceTimer: this.periodicPersistenceTimer,
            clearPersistenceTimer: () => {
                if (this.periodicPersistenceTimer) {
                    clearInterval(this.periodicPersistenceTimer);
                }
            },
            processingPromise: this.processingPromise,
            debouncedPersist: this.debouncedPersist,
            persistNow: (isFinal) => this.persistNow(isFinal),
            watcher: this.watcher,
            indexDatabase: this.indexDatabase
        });
    }


    public async waitForInitialScan(): Promise<void> {
        await waitForInitialScan({
            initialScanPromise: this.initialScanPromise,
            waitForIdle: () => this.waitForIdle(),
            flushNativeSearch: () => this.nativeSearchIndexer?.flush()
        });
    }

    public async reindexAll(): Promise<void> {
        await reindexAllOperation({
            initialScanPromise: this.initialScanPromise,
            processingPromise: this.processingPromise,
            clearQueues: () => clearQueues(this.queues),
            createEmptyIndex: () => this.indexManager.createEmptyIndex(),
            setCurrentIndex: (index) => { this.currentIndex = index; },
            persistNow: (isFinal) => this.persistNow(isFinal),
            enqueueInitialScan: () => this.enqueueInitialScan(),
            setInitialScanPromise: (promise) => { this.initialScanPromise = promise; },
            waitForIdle: () => this.waitForIdle(),
            flushNativeSearch: () => this.nativeSearchIndexer?.flush()
        });
    }

    public async shouldReindex(filePath: string): Promise<boolean> {
        return shouldReindex({
            filePath,
            currentIndex: this.currentIndex,
            fileSystem: this.fileSystem
        });
    }

    public async restoreFromPersistedIndex(index: ProjectIndex): Promise<void> {
        return restoreFromPersistedIndex({
            index,
            symbolIndex: this.symbolIndex,
            dependencyGraph: this.dependencyGraph
        });
    }
    public async waitForIdle(timeoutMs?: number): Promise<boolean> {
        return waitForIdle({
            stopped: () => this.stopped,
            isProcessing: () => this.processing,
            getQueueSize: () => getTotalQueueSize(this.queues),
            sleep: (ms) => this.sleep(ms),
            timeoutMs
        });
    }

    public getQueueStats(): { currentDepth: number; maxDepthSeen: number; currentPauseMs: number } {
        return getQueueStatsSnapshot(this.queues, this.queueMetrics);
    }

    public getActivitySnapshot(): IndexerStatusSnapshot {
        return getActivitySnapshotSnapshot({
            queues: this.queues,
            queueMetrics: this.queueMetrics,
            processing: this.processing,
            activity: this.activity
        });
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
        const queued = enqueuePathInternal({
            filePath,
            priority,
            symbolIndex: this.symbolIndex,
            isDocumentFile: (target) => this.isDocumentFile(target),
            isWithinRoot: (target) => this.isWithinRoot(target),
            documentIndexer: this.documentIndexer,
            queues: this.queues,
            removeFromQueues: (target) => removeFromQueues(this.queues, target),
            onFileQueued: this.options.onFileQueued,
            onFileIndexed: this.options.onFileIndexed,
            queueMetrics: this.queueMetrics,
            defaultPauseMs: DEFAULT_BATCH_PAUSE_MS,
            maxPauseMs: MAX_BATCH_PAUSE_MS,
            getTotalQueueSize: () => getTotalQueueSize(this.queues)
        });

        if (!queued) return;
        if (!this.processingPromise) {
            this.processingPromise = this.processQueue().finally(() => {
                this.processingPromise = null;
            });
        }
    }

    private async processQueue(): Promise<void> {
        await processQueue({
            options: this.options,
            isStopped: () => this.stopped,
            isProcessing: () => this.processing,
            setProcessing: (value) => { this.processing = value; },
            getTotalQueueSize: () => getTotalQueueSize(this.queues),
            pullNextBatch: () => pullNextBatch(this.queues),
            getCurrentPauseMs: () => this.queueMetrics.currentPauseMs,
            sleep: (ms) => this.sleep(ms),
            setActivity: (label, detail) => this.setActivity(label, detail),
            clearActivity: (label) => this.clearActivity(label),
            fileExists: (filePath) => this.fileExists(filePath),
            isDocumentFile: (filePath) => this.isDocumentFile(filePath),
            documentIndexer: this.documentIndexer,
            currentIndex: this.currentIndex,
            fileSystem: this.fileSystem,
            symbolIndex: this.symbolIndex,
            astManager: this.astManager,
            unifiedExtractor: this.unifiedExtractor,
            dependencyGraph: this.dependencyGraph,
            indexManager: this.indexManager,
            indexDatabase: this.indexDatabase,
            nativeSearchIndexer: this.nativeSearchIndexer,
            rootPath: this.rootPath,
            repoId: this.repoId,
            resolveCallgraphRank: (filePath) => resolveCallgraphRank(filePath, this.dependencyGraph),
            ensureAstManagerReady: () => this.ensureAstManagerReady(),
            updateBaselineActivity: (phase) => updateBaselineActivity({
                phase,
                baselineActive: this.baselineActive,
                baselineTotalFiles: this.baselineTotalFiles,
                baselineProcessedFiles: this.baselineProcessedFiles,
                baselineStartedAt: this.baselineStartedAt,
                onActivity: this.options.onActivity
            }),
            baseline: {
                isActive: () => this.baselineActive,
                isScanCompleted: () => this.baselineScanCompleted,
                markProcessed: () => { this.baselineProcessedFiles += 1; },
                completeIfIdle: () => {
                    this.baselineActive = false;
                    this.baselineStartedAt = 0;
                    this.baselineScanCompleted = false;
                    this.baselineTotalFiles = 0;
                    this.baselineProcessedFiles = 0;
                    this.setActivity("baseline_complete");
                    this.clearActivity("baseline_complete");
                }
            },
            debouncedPersist: () => this.debouncedPersist()
        });
    }

    private async enqueueInitialScan(): Promise<void> {
        await runInitialScan({
            rootPath: this.rootPath,
            stopped: () => this.stopped,
            fileSystem: this.fileSystem,
            symbolIndex: this.symbolIndex,
            isDocumentFile: (filePath) => this.isDocumentFile(filePath),
            shouldIgnore: (absolutePath) => this.shouldIgnore(absolutePath),
            enqueuePath: (filePath, priority) => this.enqueuePath(filePath, priority),
            batchShouldReindex: (files) => batchShouldReindex({
                files,
                stopped: () => this.stopped,
                resolveStatConcurrency: () => resolveStatConcurrency(this.options.statConcurrency),
                shouldReindex: (filePath) => this.shouldReindex(filePath)
            }),
            resolveScanBatchSize: () => resolveScanBatchSize(),
            resolveBaselineMaxMsPerTick: () => resolveBaselineMaxMsPerTick(),
            resolveBaselineMaxFilesPerTick: () => resolveBaselineMaxFilesPerTick(),
            updateBaselineActivity: (phase) => updateBaselineActivity({
                phase,
                baselineActive: this.baselineActive,
                baselineTotalFiles: this.baselineTotalFiles,
                baselineProcessedFiles: this.baselineProcessedFiles,
                baselineStartedAt: this.baselineStartedAt,
                onActivity: this.options.onActivity
            }),
            sleep: (ms) => this.sleep(ms),
            baseline: {
                start: () => {
                    this.baselineActive = true;
                    this.baselineScanCompleted = false;
                    this.baselineTotalFiles = 0;
                    this.baselineProcessedFiles = 0;
                    this.baselineStartedAt = Date.now();
                },
                incrementTotalFiles: () => { this.baselineTotalFiles += 1; },
                markScanCompleted: () => { this.baselineScanCompleted = true; },
                setScanStartedAt: () => { this.baselineScanStartedAt = Date.now(); },
                updateActivity: (phase) => updateBaselineActivity({
                    phase,
                    baselineActive: this.baselineActive,
                    baselineTotalFiles: this.baselineTotalFiles,
                    baselineProcessedFiles: this.baselineProcessedFiles,
                    baselineStartedAt: this.baselineStartedAt,
                    onActivity: this.options.onActivity
                })
            }
        });
    }

    private async ensureAstManagerReady(): Promise<void> {
        if (!this.astManagerReady) {
            const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
            this.astManagerReady = this.astManager.init({ mode: isTestEnv ? 'test' : 'prod', rootPath: this.rootPath });
        }
        await this.astManagerReady;
    }

    private async handleFileChange(filePath: string): Promise<void> {
        await handleFileChangeEvent({
            filePath,
            ignoreFileName: IGNORE_FILE,
            configFiles: CONFIG_FILES,
            onIgnoreChange: () => this.handleIgnoreChange(),
            onConfigChange: (target) => this.handleModuleConfigChange(target),
            enqueuePath: (target, priority) => this.enqueuePath(target, priority)
        });
    }

    private async handleIgnoreChange(): Promise<void> {
        await handleIgnoreChangeEvent({
            rootPath: this.rootPath,
            indexDatabase: this.indexDatabase,
            shouldIgnore: (absolutePath) => this.shouldIgnore(absolutePath),
            resolveIgnoreScanBatchSize: () => resolveIgnoreScanBatchSize(),
            enqueuePath: (target, priority) => this.enqueuePath(target, priority),
            setActivity: (label, detail) => this.setActivity(label, detail),
            clearActivity: (label) => this.clearActivity(label),
            stopped: () => this.stopped,
            fileSystem: this.fileSystem,
            symbolIndex: this.symbolIndex,
            isDocumentFile: (target) => this.isDocumentFile(target),
            resolveScanBatchSize: () => resolveScanBatchSize(),
            sleep: (ms) => this.sleep(ms)
        });
    }

    private registerConfigurationEvents(): void {
        const result = registerConfigurationEvents({
            configurationManager: this.configurationManager,
            configEventsRegistered: this.configEventsRegistered,
            configurationSubscriptions: this.configurationSubscriptions,
            handleIgnoreChange: () => this.handleIgnoreChange(),
            handleModuleConfigChange: (filePath) => this.handleModuleConfigChange(filePath)
        });
        this.configurationSubscriptions = result.subscriptions;
        this.configEventsRegistered = result.registered;
    }

    private unregisterConfigurationEvents(): void {
        const result = unregisterConfigurationEvents({
            configurationManager: this.configurationManager,
            configurationSubscriptions: this.configurationSubscriptions
        });
        this.configurationSubscriptions = result.subscriptions;
        this.configEventsRegistered = result.registered;
    }

    private async handleModuleConfigChange(filePath: string): Promise<void> {
        await handleModuleConfigChangeInternal({
            filePath,
            moduleResolver: this.moduleResolver,
            dependencyGraph: this.dependencyGraph,
            getReloadPromise: () => this.moduleConfigReloadPromise,
            setReloadPromise: (promise) => { this.moduleConfigReloadPromise = promise; },
            setActivity: (label, detail) => this.setActivity(label, detail),
            clearActivity: (label) => this.clearActivity(label)
        });
    }

    private async handleDeletion(filePath: string): Promise<void> {
        await handleFileDeletionFlow({
            rootPath: this.rootPath, repoId: this.repoId, filePath,
            isWithinRoot: (target) => this.isWithinRoot(target),
            removeFromQueues: (target) => removeFromQueues(this.queues, target),
            isDocumentFile: (target) => this.isDocumentFile(target),
            documentIndexer: this.documentIndexer, symbolIndex: this.symbolIndex,
            nativeSearchIndexer: this.nativeSearchIndexer, indexDatabase: this.indexDatabase,
            dependencyGraph: this.dependencyGraph, currentIndex: this.currentIndex,
            indexManager: this.indexManager, debouncedPersist: () => this.debouncedPersist(),
            onFileRemoved: this.options.onFileRemoved
        });
    }

    private async handleDirectoryDeletion(dirPath: string): Promise<void> {
        await handleDirectoryDeletionFlow({
            rootPath: this.rootPath, repoId: this.repoId, dirPath,
            isWithinRoot: (target) => this.isWithinRoot(target),
            removeMatchingFromQueues: (predicate) => removeMatchingFromQueues(this.queues, predicate),
            indexDatabase: this.indexDatabase, documentIndexer: this.documentIndexer,
            nativeSearchIndexer: this.nativeSearchIndexer, currentIndex: this.currentIndex,
            indexManager: this.indexManager, dependencyGraph: this.dependencyGraph,
            debouncedPersist: () => this.debouncedPersist(),
            onDirectoryRemoved: this.options.onDirectoryRemoved
        });
    }

    private isDocumentFile(filePath: string): boolean {
        return this.documentIndexer?.isSupported(filePath) ?? false;
    }

    private shouldIgnore(absolutePath: string): boolean {
        return shouldIgnorePath({
            rootPath: this.rootPath,
            absolutePath,
            symbolIndex: this.symbolIndex,
            isWithinRoot: (target) => this.isWithinRoot(target)
        });
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

    private setActivity(label: string, detail?: string): void {
        this.activity = { label, detail, startedAt: Date.now() };
    }

    private clearActivity(label?: string): void {
        if (!label || (this.activity && this.activity.label === label)) {
            this.activity = undefined;
        }
    }

    private async persistNow(isFinal = false): Promise<void> {
        await persistNowInternal({
            currentIndex: this.currentIndex,
            stopped: this.stopped,
            isFinal,
            pendingPersistence: this.pendingPersistence,
            setPendingPersistence: (promise) => { this.pendingPersistence = promise; },
            indexManager: this.indexManager
        });
    }

    private startPeriodicPersistence(): void {
        startPeriodicPersistenceInternal({
            existingTimer: this.periodicPersistenceTimer,
            setTimer: (timer) => { this.periodicPersistenceTimer = timer; },
            persistNow: () => this.persistNow()
        });
    }
}
