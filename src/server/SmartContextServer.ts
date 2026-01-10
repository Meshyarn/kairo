import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";
import * as url from "url";
import * as crypto from "crypto";
import util from "util";
import * as os from "os";

// Engine Imports
import { SearchEngine } from "../engine/Search.js";
import { ContextEngine } from "../engine/Context.js";
import { EditorEngine } from "../engine/Editor.js";
import { HistoryEngine } from "../engine/History.js";
import { EditCoordinator } from "../engine/EditCoordinator.js";
import { ImpactAnalyzer } from "../engine/ImpactAnalyzer.js";
import { FileProfiler } from "../engine/FileProfiler.js";
import { SkeletonGenerator } from "../ast/SkeletonGenerator.js";
import { SkeletonCache } from "../ast/SkeletonCache.js";
import { AstManager } from "../ast/AstManager.js";
import { SymbolIndex } from "../ast/SymbolIndex.js";
import { ModuleResolver } from "../ast/ModuleResolver.js";
import { DependencyGraph } from "../ast/DependencyGraph.js";
import { CallGraphBuilder } from "../ast/CallGraphBuilder.js";
import { TypeDependencyTracker } from "../ast/TypeDependencyTracker.js";
import { DataFlowTracer } from "../ast/DataFlowTracer.js";
import { ClusterSearchEngine } from "../engine/ClusterSearch/index.js";
import { IndexDatabase } from "../indexing/IndexDatabase.js";
import { IncrementalIndexer } from "../indexing/IncrementalIndexer.js";
import { DocumentIndexer } from "../indexing/DocumentIndexer.js";
import { IndexStateManager } from "../indexing/IndexStateManager.js";
import { EmbeddingRepository } from "../indexing/EmbeddingRepository.js";
import { DocumentChunkRepository } from "../indexing/DocumentChunkRepository.js";
import { EvidencePackRepository } from "../indexing/EvidencePackRepository.js";
import { TransactionLog } from "../engine/TransactionLog.js";
import { ConfigurationManager } from "../config/ConfigurationManager.js";
import { RepoRegistry } from "../config/RepoRegistry.js";
import { FeatureFlags, FeatureFlagContext } from "../config/FeatureFlags.js";
import { RolloutController } from "../config/RolloutController.js";
import { ModularRolloutController } from "../config/ModularRolloutController.js";
import { PathManager } from "../utils/PathManager.js";
import { FileVersionManager } from "../engine/FileVersionManager.js";
import { PathNormalizer } from "../utils/PathNormalizer.js";
import { AstAwareDiff } from "../engine/AstAwareDiff.js";
import { NodeFileSystem } from "../platform/FileSystem.js";
import { ErrorEnhancer } from "../errors/ErrorEnhancer.js";
import { ResourceUsage, DocumentKind, DocumentSection } from "../types.js";
import { GhostInterfaceBuilder } from "../resolution/GhostInterfaceBuilder.js";
import { FallbackResolver } from "../resolution/FallbackResolver.js";
import { CallSiteAnalyzer } from "../ast/analysis/CallSiteAnalyzer.js";
import { HotSpotDetector } from "../engine/ClusterSearch/HotSpotDetector.js";
import { ReferenceFinder } from "../ast/ReferenceFinder.js";
import { DocumentProfiler } from "../documents/DocumentProfiler.js";
import { extractHtmlTextPreserveLines } from "../documents/html/HtmlTextExtractor.js";
import { buildDeterministicPreview, buildDeterministicSummary } from "../documents/summary/DeterministicSummarizer.js";
import { DocumentSearchEngine } from "../documents/search/DocumentSearchEngine.js";
import { extractDocxAsHtml, DocxExtractError } from "../documents/extractors/DocxExtractor.js";
import { extractXlsxAsText, XlsxExtractError } from "../documents/extractors/XlsxExtractor.js";
import { extractPdfAsText, PdfExtractError } from "../documents/extractors/PdfExtractor.js";
import { EmbeddingProviderFactory } from "../embeddings/EmbeddingProviderFactory.js";
import { resolveEmbeddingConfigFromEnv } from "../embeddings/EmbeddingConfig.js";
import { metrics } from "../utils/MetricsCollector.js";
import { VectorIndexManager } from "../vector/VectorIndexManager.js";
import { AdaptiveFlowReporter } from "../utils/AdaptiveFlowReporter.js";
import { AlertDispatcher } from "../utils/AlertDispatcher.js";

// Orchestration Imports
import { OrchestrationEngine } from "../orchestration/OrchestrationEngine.js";
import { IntentRouter } from "../orchestration/IntentRouter.js";
import { WorkflowPlanner } from "../orchestration/WorkflowPlanner.js";
import { InternalToolRegistry } from "../orchestration/InternalToolRegistry.js";
import { CachingStrategy } from "../orchestration/CachingStrategy.js";
import { FlowArtifactManager } from "../orchestration/flow-artifact-manager.js";

// Handler Imports
import { SearchHandlers } from "../handlers/SearchHandlers.js";
import { CodeHandlers } from "../handlers/CodeHandlers.js";
import { EditHandlers } from "../handlers/EditHandlers.js";
import { DocumentHandlers } from "../handlers/DocumentHandlers.js";
import { ManageHandlers } from "../handlers/ManageHandlers.js";
import { NavigateHandlers } from "../handlers/NavigateHandlers.js";
import { IntegrityHandlers } from "../handlers/IntegrityHandlers.js";
import { HandlerRegistry } from "../handlers/HandlerRegistry.js";
import { createHandlerContext } from "../handlers/HandlerContext.js";

export class SmartContextServer {
    private server: Server;
    private rootPath: string;
    private fileSystem: NodeFileSystem;
    private flowArtifactManager: FlowArtifactManager;
    private orchestrationEngine: OrchestrationEngine;
    private internalRegistry: InternalToolRegistry;
    private incrementalIndexer?: IncrementalIndexer;
    private searchEngine: SearchEngine;
    private editCoordinator: EditCoordinator;
    private historyEngine: HistoryEngine;
    private configurationManager: ConfigurationManager;
    private repoRegistry: RepoRegistry;
    private astManager: AstManager;
    private skeletonGenerator: SkeletonGenerator;
    private skeletonCache: SkeletonCache;
    private symbolIndex: SymbolIndex;
    private dependencyGraph: DependencyGraph;
    private callGraphBuilder: CallGraphBuilder;
    private typeDependencyTracker: TypeDependencyTracker;
    private dataFlowTracer: DataFlowTracer;
    private moduleResolver: ModuleResolver;
    private referenceFinder: ReferenceFinder;
    private contextEngine: ContextEngine;
    private fileVersionManager: FileVersionManager;
    private pathNormalizer: PathNormalizer;
    private hotSpotDetector: HotSpotDetector;
    private documentProfiler: DocumentProfiler;
    private documentIndexer?: DocumentIndexer;
    private embeddingRepository: EmbeddingRepository;
    private embeddingProviderFactory: EmbeddingProviderFactory;
    private vectorIndexManager: VectorIndexManager;
    private documentSearchEngine: DocumentSearchEngine;
    private ghostInterfaceBuilder: GhostInterfaceBuilder;
    private fallbackResolver: FallbackResolver;
    private clusterSearchEngine: ClusterSearchEngine;
    private impactAnalyzer: ImpactAnalyzer;
    private indexDatabase: IndexDatabase;
    private indexStateManager: IndexStateManager;
    private logStream?: fs.WriteStream;
    private logStreams?: {
        console: fs.WriteStream;
        warn: fs.WriteStream;
        error: fs.WriteStream;
        stdout: fs.WriteStream;
        stderr: fs.WriteStream;
    };
    private diagnosticsInitialized = false;
    private reindexInProgress = false;
    private reindexLastResult?: { success: boolean; output: string; startedAt: string; finishedAt?: string };
    private heartbeatTimer?: NodeJS.Timeout;
    private shutdownRequested = false;
    private shutdownTimer?: NodeJS.Timeout;
    private metricsReporter?: AdaptiveFlowReporter;
    private alertDispatcher?: AlertDispatcher;

    private searchHandlers!: SearchHandlers;
    private codeHandlers!: CodeHandlers;
    private editHandlers!: EditHandlers;
    private documentHandlers!: DocumentHandlers;
    private manageHandlers!: ManageHandlers;
    private navigateHandlers!: NavigateHandlers;
    private integrityHandlers!: IntegrityHandlers;
    private handlerRegistry!: HandlerRegistry;


    constructor(rootPath: string) {
        this.server = new Server({
            name: "kairo",
            version: "4.0.0",
        }, {
            capabilities: { tools: {} },
        });

        this.rootPath = path.resolve(rootPath);
        RolloutController.applyFromEnv();
        ModularRolloutController.applyFromEnv();
        PathManager.setRoot(this.rootPath);
        this.fileSystem = new NodeFileSystem(this.rootPath);
        this.alertDispatcher = new AlertDispatcher({
            rootPath: this.rootPath,
            logDir: process.env.KAIRO_ALERT_LOG_DIR
                ?? process.env.KAIRO_METRICS_DIR
                ?? path.join(this.rootPath, ".kairo", "logs"),
            webhookUrl: process.env.KAIRO_ALERT_WEBHOOK,
            command: process.env.KAIRO_ALERT_COMMAND,
            pagerDutyRoutingKey: process.env.KAIRO_PAGERDUTY_ROUTING_KEY,
            severity: this.resolveAlertSeverity(),
            channel: process.env.KAIRO_ALERT_CHANNEL ?? undefined,
            label: process.env.KAIRO_ALERT_LABEL ?? undefined
        });
        this.initFileLogger();
        this.initProcessDiagnostics();
        this.astManager = AstManager.getInstance();
        this.pathNormalizer = new PathNormalizer(this.rootPath);
        this.configurationManager = new ConfigurationManager(this.rootPath);
        this.repoRegistry = new RepoRegistry(this.rootPath);
        const initialIgnorePatterns = this.configurationManager.getIgnoreGlobs();
        const ignoreFilter = this.createIgnoreFilter(initialIgnorePatterns);
        this.contextEngine = new ContextEngine(ignoreFilter, this.fileSystem);
        
        // Initialize Core Engines
        this.skeletonGenerator = new SkeletonGenerator();
        this.skeletonCache = new SkeletonCache(this.rootPath);
        this.indexDatabase = new IndexDatabase(this.rootPath);
        this.embeddingRepository = new EmbeddingRepository(this.indexDatabase);
        this.embeddingProviderFactory = new EmbeddingProviderFactory(resolveEmbeddingConfigFromEnv());
        this.vectorIndexManager = new VectorIndexManager(this.rootPath, this.embeddingRepository);
        void this.vectorIndexManager.initializeFromEmbeddingConfig(this.embeddingProviderFactory.getConfig());
        this.documentProfiler = new DocumentProfiler(this.rootPath);
        this.documentIndexer = new DocumentIndexer(this.rootPath, this.fileSystem, this.indexDatabase, {
            embeddingRepository: this.embeddingRepository,
            embeddingProviderFactory: this.embeddingProviderFactory,
            vectorIndexManager: this.vectorIndexManager
        });
        this.symbolIndex = new SymbolIndex(this.rootPath, this.skeletonGenerator, initialIgnorePatterns, this.indexDatabase);
        this.moduleResolver = new ModuleResolver(this.rootPath);
        this.dependencyGraph = new DependencyGraph(this.rootPath, this.symbolIndex, this.moduleResolver, this.indexDatabase);
        this.callGraphBuilder = new CallGraphBuilder(this.rootPath, this.symbolIndex, this.moduleResolver);
        this.typeDependencyTracker = new TypeDependencyTracker(this.rootPath, this.symbolIndex);
        this.dataFlowTracer = new DataFlowTracer(this.rootPath, this.symbolIndex, this.fileSystem);
        this.impactAnalyzer = new ImpactAnalyzer(this.dependencyGraph, this.callGraphBuilder, this.symbolIndex);
        this.hotSpotDetector = new HotSpotDetector(this.symbolIndex, this.dependencyGraph);
        this.referenceFinder = new ReferenceFinder(
            this.rootPath,
            this.dependencyGraph,
            this.symbolIndex,
            this.skeletonGenerator,
            this.moduleResolver
        );

        this.indexStateManager = new IndexStateManager(async () => {
            const status = await this.dependencyGraph.getIndexStatus();
            const totalFiles = status?.global?.totalFiles ?? 0;
            const indexedFiles = status?.global?.indexedFiles ?? totalFiles;
            const lastRebuilt = status?.global?.lastRebuiltAt
                ? Date.parse(status.global.lastRebuiltAt)
                : undefined;
            return { totalFiles, indexedFiles, lastIndexedAt: Number.isFinite(lastRebuilt) ? lastRebuilt : undefined };
        });
        const toRelative = (filePath: string) => path.relative(this.rootPath, filePath).replace(/\\/g, '/');
        this.incrementalIndexer = new IncrementalIndexer(
            this.rootPath,
            this.symbolIndex,
            this.dependencyGraph,
            this.indexDatabase,
            this.moduleResolver,
            this.configurationManager,
            {
                watch: true,
                initialScan: false,
                onFileQueued: (filePath) => this.indexStateManager.markDirty(toRelative(filePath)),
                onFileIndexed: (filePath) => this.indexStateManager.clearDirty(toRelative(filePath)),
                onFileRemoved: (filePath) => this.indexStateManager.clearDirty(toRelative(filePath))
            },
            this.documentIndexer
        );

        this.searchEngine = new SearchEngine(this.rootPath, this.fileSystem, [], {
            symbolIndex: this.symbolIndex,
            callGraphBuilder: this.callGraphBuilder,
            dependencyGraph: this.dependencyGraph
        });
        this.documentSearchEngine = new DocumentSearchEngine(
            this.searchEngine,
            this.documentIndexer,
            new DocumentChunkRepository(this.indexDatabase),
            this.embeddingRepository,
            this.embeddingProviderFactory,
            this.rootPath,
            this.symbolIndex,
            new EvidencePackRepository(this.indexDatabase),
            this.vectorIndexManager
        );
        this.clusterSearchEngine = new ClusterSearchEngine({
            rootPath: this.rootPath,
            symbolIndex: this.symbolIndex,
            callGraphBuilder: this.callGraphBuilder,
            typeDependencyTracker: this.typeDependencyTracker,
            dependencyGraph: this.dependencyGraph,
            fileSystem: this.fileSystem
        });

        const historyEngine = new HistoryEngine(this.rootPath, this.fileSystem);
        this.historyEngine = historyEngine;
        const editorEngine = new EditorEngine(this.rootPath, this.fileSystem, new AstAwareDiff(this.skeletonGenerator));
        const transactionLog = new TransactionLog(this.indexDatabase);

        this.editCoordinator = new EditCoordinator(editorEngine, historyEngine, {
            rootPath: this.rootPath,
            transactionLog,
            fileSystem: this.fileSystem,
            impactAnalyzer: this.impactAnalyzer
        });

        this.fileVersionManager = new FileVersionManager(this.fileSystem);
        this.applyIgnorePatterns(initialIgnorePatterns);
        this.configurationManager.on("ignoreChanged", (payload) => {
            this.applyIgnorePatterns(payload?.patterns ?? []);
        });
        this.ghostInterfaceBuilder = new GhostInterfaceBuilder(
            this.searchEngine,
            new CallSiteAnalyzer(),
            this.astManager,
            this.fileSystem,
            this.rootPath
        );
        this.fallbackResolver = new FallbackResolver(this.symbolIndex, this.skeletonGenerator, this.ghostInterfaceBuilder);

        // Orchestration Layer
        this.internalRegistry = new InternalToolRegistry();
        this.flowArtifactManager = new FlowArtifactManager();
        this.orchestrationEngine = new OrchestrationEngine(
            new IntentRouter(),
            new WorkflowPlanner(),
            this.internalRegistry,
            new CachingStrategy(this.rootPath)
        );
        this.registerInternalTools();
        
        // Store searchEngine reference for pillars to access
        this.internalRegistry.setMetadata('searchEngine', this.searchEngine);
        this.internalRegistry.setMetadata('indexStateManager', this.indexStateManager);
        this.internalRegistry.setMetadata('dependencyGraph', this.dependencyGraph);
        this.internalRegistry.setMetadata('flowArtifactManager', this.flowArtifactManager);
        
        this.setupHandlers();
        this.initializeModularHandlers();
        this.setupShutdownHooks();

        this.startHeartbeat();
        this.initMetricsReporter();
    }

    private initializeModularHandlers(): void {
        this.handlerRegistry = new HandlerRegistry();
        const handlerContext = createHandlerContext({
            rootPath: this.rootPath,
            repoRegistry: this.repoRegistry,
            fileSystem: this.fileSystem,
            orchestrationEngine: this.orchestrationEngine,
            internalRegistry: this.internalRegistry,
            searchEngine: this.searchEngine,
            documentSearchEngine: this.documentSearchEngine,
            symbolIndex: this.symbolIndex,
            astManager: this.astManager,
            contextEngine: this.contextEngine,
            dependencyGraph: this.dependencyGraph,
            callGraphBuilder: this.callGraphBuilder,
            impactAnalyzer: this.impactAnalyzer,
            typeDependencyTracker: this.typeDependencyTracker,
            dataFlowTracer: this.dataFlowTracer,
            skeletonGenerator: this.skeletonGenerator,
            skeletonCache: this.skeletonCache,
            referenceFinder: this.referenceFinder,
            documentProfiler: this.documentProfiler,
            fallbackResolver: this.fallbackResolver,
            pathNormalizer: this.pathNormalizer,
            editCoordinator: this.editCoordinator,
            fileVersionManager: this.fileVersionManager,
            indexStateManager: this.indexStateManager,
            incrementalIndexer: this.incrementalIndexer,
            documentIndexer: this.documentIndexer,
            indexDatabase: this.indexDatabase,
            historyEngine: this.historyEngine,
            flowArtifactManager: this.flowArtifactManager,
            isTestEnv: () => this.isTestEnv()
        });
        this.searchHandlers = new SearchHandlers(handlerContext);
        this.codeHandlers = new CodeHandlers(handlerContext);
        this.editHandlers = new EditHandlers(handlerContext);
        this.documentHandlers = new DocumentHandlers(handlerContext);
        this.manageHandlers = new ManageHandlers(handlerContext);
        this.navigateHandlers = new NavigateHandlers(handlerContext);
        this.integrityHandlers = new IntegrityHandlers(handlerContext);

        this.handlerRegistry.register(this.searchHandlers);
        this.handlerRegistry.register(this.codeHandlers);
        this.handlerRegistry.register(this.editHandlers);
        this.handlerRegistry.register(this.documentHandlers);
        this.handlerRegistry.register(this.manageHandlers);
        this.handlerRegistry.register(this.navigateHandlers);
        this.handlerRegistry.register(this.integrityHandlers);
    }

    private isTestEnv(): boolean {

        return process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID != null;
    }

    private registerInternalTools(): void {
        this.internalRegistry.register('code_read', (args) => (this.codeHandlers as any).readCodeRaw(args));
        this.internalRegistry.register('project_search', (args) => (this.searchHandlers as any).searchProjectRaw(args));
        this.internalRegistry.register('file_search', (args) => (this.searchHandlers as any).searchFilesRaw(args));
        this.internalRegistry.register('file_scout', (args) => (this.searchHandlers as any).scoutFilesRaw(args));
        this.internalRegistry.register('file_list', (args) => (this.codeHandlers as any).listFilesRaw(args));
        this.internalRegistry.register('file_stat', (args) => (this.codeHandlers as any).statFileRaw(args));
        this.internalRegistry.register('relationship_analyze', (args) => (this.codeHandlers as any).analyzeRelationshipRaw(args));
        this.internalRegistry.register('edit_apply', (args) => (this.editHandlers as any).editCodeRaw(args));
        this.internalRegistry.register('project_manage', (args) => (this.manageHandlers as any).manageProjectRaw(args));
        this.internalRegistry.register('file_profile', (args) => (this.codeHandlers as any).readFileProfileRaw(args));
        this.internalRegistry.register('file_write', (args) => (this.editHandlers as any).executeWriteFile(args));
        this.internalRegistry.register('impact_analyze', (args) => (this.editHandlers as any).executeImpactAnalyzer(args));
        this.internalRegistry.register('edit_transaction', (args) => (this.editHandlers as any).executeEditCoordinator(args));
        this.internalRegistry.register('hotspot_detect', () => this.hotSpotDetector.detectHotSpots());
        this.internalRegistry.register('reference_find', (args) => (this.codeHandlers as any).findReferencesRaw(args));
        this.internalRegistry.register('project_profile', () => (this.codeHandlers as any).projectStatsRaw());
        this.internalRegistry.register('document_toc', (args) => (this.documentHandlers as any).docTocRaw(args));
        this.internalRegistry.register('document_skeleton', (args) => (this.documentHandlers as any).docSkeletonRaw(args));
        this.internalRegistry.register('document_section', (args) => (this.documentHandlers as any).docSectionRaw(args));
        this.internalRegistry.register('document_analyze', (args) => (this.documentHandlers as any).docAnalyzeRaw(args));
        this.internalRegistry.register('document_search', (args) => (this.documentHandlers as any).docSearchRaw(args));
        this.internalRegistry.register('document_references', (args) => (this.documentHandlers as any).docReferencesRaw(args));
    }

    private setupHandlers(): void {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: this.listIntentTools(),
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            return this.handleCallTool(request.params.name, request.params.arguments);
        });
    }

    private initFileLogger(): void {
        if (this.logStream) return;
        const enabled = process.env.KAIRO_LOG_TO_FILE === "true" || !!process.env.KAIRO_LOG_FILE;
        if (!enabled) return;
        const singleFilePath = process.env.KAIRO_LOG_FILE;
        const logDir = process.env.KAIRO_LOG_DIR
            || path.join(this.rootPath, ".kairo", "logs");
        try {
            if (singleFilePath) {
                fs.mkdirSync(path.dirname(singleFilePath), { recursive: true });
                this.logStream = fs.createWriteStream(singleFilePath, { flags: "a" });
            } else {
                fs.mkdirSync(logDir, { recursive: true });
                this.logStreams = {
                    console: fs.createWriteStream(path.join(logDir, "console.log"), { flags: "a" }),
                    warn: fs.createWriteStream(path.join(logDir, "console.warn.log"), { flags: "a" }),
                    error: fs.createWriteStream(path.join(logDir, "console.error.log"), { flags: "a" }),
                    stdout: fs.createWriteStream(path.join(logDir, "stdout.log"), { flags: "a" }),
                    stderr: fs.createWriteStream(path.join(logDir, "stderr.log"), { flags: "a" })
                };
            }
        } catch (error) {
            console.warn("[SmartContextServer] Failed to initialize file logger:", error);
            return;
        }

        const writeLine = (level: string, args: unknown[], stream?: fs.WriteStream) => {
            const target = stream ?? this.logStream;
            if (!target) return;
            const timestamp = new Date().toISOString();
            const message = util.format(...args);
            target.write(`[${timestamp}] [${level}] ${message}\n`);
        };

        const wrap = (level: string, original: (...args: unknown[]) => void, stream?: fs.WriteStream) => {
            return (...args: unknown[]) => {
                original(...args);
                writeLine(level, args, stream);
            };
        };

        console.log = wrap("log", console.log.bind(console), this.logStreams?.console);
        console.info = wrap("info", console.info.bind(console), this.logStreams?.console);
        console.debug = wrap("debug", console.debug.bind(console), this.logStreams?.console);
        console.warn = wrap("warn", console.warn.bind(console), this.logStreams?.warn);
        console.error = wrap("error", console.error.bind(console), this.logStreams?.error);

        const stdoutWrite = process.stdout.write.bind(process.stdout);
        const stderrWrite = process.stderr.write.bind(process.stderr);
        const teeStream = (level: string, original: typeof stdoutWrite, stream?: fs.WriteStream) => {
            return (chunk: any, encoding?: any, cb?: any) => {
                try {
                    const target = stream ?? this.logStream;
                    if (target) {
                        const timestamp = new Date().toISOString();
                        const text = typeof chunk === "string" ? chunk : chunk?.toString?.(encoding) ?? "";
                        if (text.length > 0) {
                            const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
                            for (const line of lines) {
                                if (line.length === 0) continue;
                                target.write(`[${timestamp}] [${level}] ${line}\n`);
                            }
                        }
                    }
                } catch {
                    // ignore
                }
                return original(chunk, encoding as any, cb as any);
            };
        };

        process.stdout.write = teeStream("stdout", stdoutWrite, this.logStreams?.stdout) as typeof process.stdout.write;
        process.stderr.write = teeStream("stderr", stderrWrite, this.logStreams?.stderr) as typeof process.stderr.write;

        process.on("exit", () => {
            try {
                this.logStream?.end();
                if (this.logStreams) {
                    this.logStreams.console.end();
                    this.logStreams.warn.end();
                    this.logStreams.error.end();
                    this.logStreams.stdout.end();
                    this.logStreams.stderr.end();
                }
            } catch {
                // ignore
            }
        });
    }

    private initProcessDiagnostics(): void {
        if (this.diagnosticsInitialized) return;
        if (this.isTestEnv()) {
            this.diagnosticsInitialized = true;
            return;
        }
        this.diagnosticsInitialized = true;

        const logMemory = (label: string) => {
            try {
                const mem = process.memoryUsage();
                const mb = (value: number) => Math.round((value / (1024 * 1024)) * 100) / 100;
                console.warn(`[Process] ${label} rss=${mb(mem.rss)}MB heapUsed=${mb(mem.heapUsed)}MB heapTotal=${mb(mem.heapTotal)}MB ext=${mb(mem.external)}MB`);
            } catch {
                // ignore
            }
        };

        process.on("uncaughtException", (err) => {
            console.error("[Process] uncaughtException", err);
            logMemory("uncaughtException");
            if (!this.isTestEnv()) {
                process.exit(1);
            }
        });
        process.on("unhandledRejection", (reason) => {
            console.error("[Process] unhandledRejection", reason);
            logMemory("unhandledRejection");
            if (!this.isTestEnv()) {
                process.exit(1);
            }
        });
        process.on("warning", (warning) => {
            console.warn("[Process] warning", warning);
        });
        process.on("exit", (code) => {
            console.warn(`[Process] exit code=${code}`);
            logMemory("exit");
        });
        process.on("SIGTERM", () => {
            console.warn("[Process] SIGTERM received");
            logMemory("SIGTERM");
        });
        process.on("SIGINT", () => {
            console.warn("[Process] SIGINT received");
            logMemory("SIGINT");
        });
        process.on("SIGHUP", () => {
            console.warn("[Process] SIGHUP received");
            logMemory("SIGHUP");
        });
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer) return;
        const enabled = process.env.KAIRO_HEARTBEAT !== "false" && !this.isTestEnv();
        if (!enabled) return;
        this.heartbeatTimer = setInterval(() => {
            try {
                console.warn("[Heartbeat] alive");
            } catch {
                // ignore
            }
        }, 5000);
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatTimer) return;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
    }

    private shouldWarmupSearchIndex(): boolean {
        const enabled = (process.env.KAIRO_WARMUP_ENABLED ?? "true").toLowerCase();
        if (enabled === "false" || enabled === "0") return false;

        const maxFiles = Number(process.env.KAIRO_WARMUP_MAX_FILES ?? "");
        if (!Number.isFinite(maxFiles) || maxFiles <= 0) return true;

        const indexedFiles = this.indexDatabase.listFiles().length;
        if (indexedFiles === 0) {
            const allowEmpty = (process.env.KAIRO_WARMUP_ON_EMPTY_INDEX ?? "false").toLowerCase();
            return allowEmpty === "true" || allowEmpty === "1";
        }
        return indexedFiles <= maxFiles;
    }

    private initMetricsReporter(): void {
        if (this.isTestEnv()) return;
        const enabled = process.env.KAIRO_METRICS_ENABLED !== "false";
        if (!enabled) return;
        const reporter = new AdaptiveFlowReporter({
            rootPath: this.rootPath,
            exportDir: process.env.KAIRO_METRICS_DIR
                ?? path.join(this.rootPath, ".kairo", "logs"),
            exportIntervalMs: this.parseNumberEnv(process.env.KAIRO_METRICS_INTERVAL_MS, 60_000),
            alertThresholds: {
                topologySuccessRate: this.parseNumberEnv(process.env.KAIRO_TOPOLOGY_SUCCESS_MIN, 0.95),
                ucgMemoryMb: this.parseNumberEnv(process.env.KAIRO_UCG_MEMORY_MAX_MB, 500),
                l3PromotionRatio: this.parseNumberEnv(process.env.KAIRO_L3_PROMOTION_RATIO_MAX, 0.5)
            },
            onAlert: payload => {
                console.warn(`[AdaptiveFlowReporter] ${payload.type}: ${payload.message}`);
                if (this.alertDispatcher) {
                    void this.alertDispatcher.dispatch(payload).catch(error => {
                        console.warn('[AdaptiveFlowReporter] Failed to forward alert', error);
                    });
                }
            }
        });
        reporter.start();
        this.metricsReporter = reporter;
    }

    private parseNumberEnv(raw: string | undefined, fallback: number): number {
        if (!raw) return fallback;
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    }

    private resolveAlertSeverity(): 'info' | 'warning' | 'error' | 'critical' {
        const raw = (process.env.KAIRO_ALERT_SEVERITY ?? 'warning').toLowerCase();
        if (raw === 'info' || raw === 'warning' || raw === 'error' || raw === 'critical') {
            return raw;
        }
        return 'warning';
    }

    private setupShutdownHooks(): void {
        if (this.isTestEnv()) return;
        const handle = (reason: string, error?: unknown) => {
            if (this.shutdownRequested) return;
            this.shutdownRequested = true;
            const timeoutMs = Number(process.env.KAIRO_SHUTDOWN_TIMEOUT_MS ?? 5000);
            if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
                this.shutdownTimer = setTimeout(() => {
                    console.warn(`[Process] shutdown timeout exceeded (${timeoutMs}ms); forcing exit`);
                    process.exit(1);
                }, timeoutMs);
                this.shutdownTimer.unref?.();
            }
            if (error) {
                console.warn(`[Process] shutdown requested (${reason})`, error);
            } else {
                console.warn(`[Process] shutdown requested (${reason})`);
            }
            void this.shutdown().finally(() => {
                if (this.shutdownTimer) {
                    clearTimeout(this.shutdownTimer);
                    this.shutdownTimer = undefined;
                }
                if (!this.isTestEnv()) {
                    process.exit(0);
                }
            });
        };

        process.on("SIGTERM", () => handle("SIGTERM"));
        process.on("SIGINT", () => handle("SIGINT"));
        process.on("SIGHUP", () => handle("SIGHUP"));

        process.stdin.on("end", () => handle("stdin_end"));
        process.stdin.on("close", () => handle("stdin_close"));
        process.stdin.on("error", (err) => handle("stdin_error", err));
        process.stdin.resume();
    }

    private createIgnoreFilter(patterns: string[]): any {
        const ig = (ignore as unknown as () => any)();
        if (Array.isArray(patterns) && patterns.length > 0) {
            ig.add(patterns);
        }
        return ig;
    }

    private applyIgnorePatterns(patterns: string[]): void {
        const normalized = Array.isArray(patterns) ? patterns : [];
        this.symbolIndex.updateIgnorePatterns(normalized);
        this.contextEngine.updateIgnoreFilter(this.createIgnoreFilter(normalized));
        void this.searchEngine.updateExcludeGlobs(normalized);
        this.documentIndexer?.updateIgnorePatterns(normalized);
    }

    private listIntentTools(): any[] {
        const internalTools = [
            {
                name: 'code_read',
                description: 'Read file content in full, skeleton, or fragment modes.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' },
                        view: { type: 'string', enum: ['full', 'skeleton', 'fragment'] },
                        lineRange: { type: 'string' }
                    },
                    required: ['filePath']
                }
            },
            {
                name: 'project_search',
                description: 'Search for symbols, files, or content across the project.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        type: { type: 'string', enum: ['auto', 'file', 'symbol', 'directory', 'filename'] },
                        maxResults: { type: 'number' }
                    },
                    required: ['query']
                }
            },
            {
                name: 'document_search',
                description: 'Search project documents (md/mdx/txt/html/css + well-known text files) with hybrid ranking (BM25 + vector). Optionally include code comments as a separate corpus (kind="code_comment").',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        scope: { type: 'string', enum: ['all', 'docs', 'project'] },
                        output: { type: 'string', enum: ['full', 'compact', 'pack_only'] },
                        packId: { type: 'string' },
                        maxResults: { type: 'number' },
                        maxCandidates: { type: 'number' },
                        maxChunkCandidates: { type: 'number' },
                        maxVectorCandidates: { type: 'number' },
                        maxEvidenceSections: { type: 'number' },
                        maxEvidenceChars: { type: 'number' },
                        includeEvidence: { type: 'boolean' },
                        snippetLength: { type: 'number' },
                        rrfK: { type: 'number' },
                        rrfDepth: { type: 'number' },
                        useMmr: { type: 'boolean' },
                        mmrLambda: { type: 'number' },
                        maxChunksEmbeddedPerRequest: { type: 'number' },
                        maxEmbeddingTimeMs: { type: 'number' },
                        includeComments: { type: 'boolean' },
                        includeLogs: { type: 'boolean' },
                        includeMetrics: { type: 'boolean' },
                        embedding: {
                            type: 'object',
                            properties: {
                                provider: { type: 'string', enum: ['auto', 'local', 'hash', 'disabled'] },
                                normalize: { type: 'boolean' },
                                batchSize: { type: 'number' },
                                modelDir: { type: 'string' },
                                local: {
                                    type: 'object',
                                    properties: {
                                        model: { type: 'string' },
                                        dims: { type: 'number' }
                                    }
                                }
                            }
                        }
                    },
                    required: ['query']
                }
            },
            {
                name: 'document_references',
                description: 'List resolved references (links) found in a markdown/MDX document.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' }
                    },
                    required: ['filePath']
                }
            },
            {
                name: 'relationship_analyze',
                description: 'Analyze dependencies, call graphs, data flow, or impact.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        target: { type: 'string' },
                        mode: { type: 'string', enum: ['impact', 'dependencies', 'calls', 'data_flow', 'types'] },
                        direction: { type: 'string', enum: ['upstream', 'downstream', 'both'] },
                        contextPath: { type: 'string' },
                        maxDepth: { type: 'number' },
                        fromLine: { type: 'number' }
                    },
                    required: ['target', 'mode']
                }
            },
            {
                name: 'edit_apply',
                description: 'Apply structured edits to files with optional dry-run.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        edits: { type: 'array', items: { type: 'object' } },
                        dryRun: { type: 'boolean' },
                        diffMode: { type: 'string', enum: ['myers', 'semantic'] }
                    },
                    required: ['edits']
                }
            },
            {
                name: 'edit_guidance',
                description: 'Suggests batch edit groupings and companion changes.',
                inputSchema: {
                    type: 'object',
                    properties: { filePaths: { type: 'array', items: { type: 'string' } }, pattern: { type: 'string' } },
                    required: ['filePaths']
                }
            },
            {
                name: 'project_manage',
                description: 'Manage project state (status, undo, redo, reindex).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            enum: [
                                'status',
                                'undo',
                                'redo',
                                'reindex',
                                'history',
                                'test',
                                'metrics',
                                'metrics_reset',
                                'config',
                                'init',
                                'doctor',
                                'sessions',
                                'session',
                                'session_complete',
                                'artifacts',
                                'artifact',
                                'discard',
                                'prune',
                                'export',
                                'import'
                            ]
                        },
                        target: { type: 'string' },
                        outcome: { type: 'object' },
                        mode: { type: 'string', enum: ['plan', 'apply'] },
                        targets: { type: 'array', items: { type: 'string', enum: ['kairo', 'vscode'] } },
                        root: { type: 'string' },
                        multiRepo: { type: 'string', enum: ['auto', 'single', 'detect'] },
                        presets: { type: 'string', enum: ['minimal', 'recommended'] },
                        languageScan: {
                            type: 'object',
                            properties: {
                                maxFiles: { type: 'number' },
                                sampleBytesPerFile: { type: 'number' },
                                includeDocs: { type: 'boolean' }
                            }
                        },
                        applyOptions: {
                            type: 'object',
                            properties: {
                                backup: { type: 'boolean' },
                                legacyMcpConfig: { type: 'boolean' }
                            }
                        }
                    },
                    required: ['command']
                }
            },
            {
                name: 'interface_reconstruct',
                description: 'Reconstruct a ghost interface based on observed call sites.',
                inputSchema: {
                    type: 'object',
                    properties: { symbolName: { type: 'string' } },
                    required: ['symbolName']
                }
            }
        ];

        const pillarTools = [
            {
                name: 'understand',
                description: 'Deeply analyzes code structure and architecture.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        goal: { type: 'string' },
                        profile: { type: 'string', enum: ['fast', 'balanced', 'deep'] },
                        sources: { type: 'string', enum: ['code', 'docs', 'both'] },
                        depth: { type: 'string', enum: ['shallow', 'standard', 'deep'] },
                        scope: { type: 'string', enum: ['symbol', 'file', 'module', 'project'] },
                        include: {
                            type: 'object',
                            properties: {
                                callGraph: { type: 'boolean' },
                                hotSpots: { type: 'boolean' },
                                pageRank: { type: 'boolean' },
                                dependencies: { type: 'boolean' }
                            }
                        },
                        sessionId: { type: 'string' },
                        trace: { type: 'boolean' },
                        vibe: {
                            type: 'object',
                            properties: {
                                extract: { type: 'boolean' },
                                scope: { type: 'string' },
                                includeNorms: { type: 'boolean' }
                            }
                        },
                        analysis: {
                            type: 'object',
                            properties: {
                                clusters: { type: 'boolean' },
                                maxClusters: { type: 'number' },
                                maxFilesPerCluster: { type: 'number' }
                            }
                        },
                        limits: {
                            type: 'object',
                            properties: {
                                timeoutMs: { type: 'number' }
                            }
                        }
                    },
                    required: ['goal']
                }
            },
            {
                name: 'explore',
                description: 'Unified discovery for docs/code with previews, sections, and controlled full reads.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        paths: { type: 'array', items: { type: 'string' } },
                        profile: { type: 'string', enum: ['fast', 'balanced', 'deep'] },
                        sources: { type: 'string', enum: ['code', 'docs', 'both'] },
                        view: { type: 'string', enum: ['auto', 'preview', 'section', 'full'] },
                        include: {
                            type: 'object',
                            properties: {
                                docs: { type: 'boolean' },
                                code: { type: 'boolean' },
                                comments: { type: 'boolean' },
                                logs: { type: 'boolean' }
                            }
                        },
                        sessionId: { type: 'string' },
                        trace: { type: 'boolean' },
                        research: {
                            type: 'object',
                            properties: {
                                sketch: { type: 'boolean' },
                                topN: { type: 'number' },
                                format: { type: 'string', enum: ['ascii', 'mermaid', 'both'] }
                            }
                        },
                        section: {
                            type: 'object',
                            properties: {
                                sectionId: { type: 'string' },
                                headingPath: { type: 'array', items: { type: 'string' } },
                                includeSubsections: { type: 'boolean' }
                            }
                        },
                        packId: { type: 'string' },
                        cursor: {
                            type: 'object',
                            properties: {
                                items: { type: 'string' },
                                content: { type: 'string' }
                            }
                        },
                        limits: {
                            type: 'object',
                            properties: {
                                maxResults: { type: 'number' },
                                maxChars: { type: 'number' },
                                maxItemChars: { type: 'number' },
                                maxBytes: { type: 'number' },
                                maxFiles: { type: 'number' },
                                timeoutMs: { type: 'number' }
                            }
                        },
                        fullPaths: { type: 'array', items: { type: 'string' } },
                        allowSensitive: { type: 'boolean' },
                        allowBinary: { type: 'boolean' },
                        allowGlobs: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'change',
                description: 'Safely modifies code with impact analysis.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        intent: { type: 'string' },
                        profile: { type: 'string', enum: ['fast', 'balanced', 'deep'] },
                        safety: { type: 'string', enum: ['plan', 'apply'] },
                        target: { type: 'string' },
                        targetFiles: { type: 'array', items: { type: 'string' } },
                        edits: { type: 'array', items: { type: 'object' } },
                        sessionId: { type: 'string' },
                        trace: { type: 'boolean' },
                        stylePack: { anyOf: [{ type: 'string' }, { type: 'object' }] },
                        draftOptions: {
                            type: 'object',
                            properties: {
                                skeletonOnly: { type: 'boolean' },
                                includeImpact: { type: 'boolean' }
                            }
                        },
                        draftId: { type: 'string' },
                        refinement: { type: 'string' },
                        reviewOptions: {
                            type: 'object',
                            properties: {
                                preApply: { type: 'boolean' },
                                postApply: { type: 'boolean' },
                                strictness: { type: 'string', enum: ['strict', 'balanced', 'permissive'] },
                                blockOn: { type: 'array', items: { type: 'string', enum: ['syntax', 'semantic', 'guardrails', 'vibe'] } }
                            }
                        },
                        options: {
                            type: 'object',
                            properties: {
                                dryRun: { type: 'boolean' },
                                includeImpact: { type: 'boolean' },
                                includeSymbolImpact: { type: 'boolean' },
                                autoRollback: { type: 'boolean' },
                                batchMode: { type: 'boolean' },
                                suggestDocs: { type: 'boolean' },
                                batchImpactLimit: { type: 'number' }
                            }
                        }
                    },
                    required: ['intent']
                }
            },
            {
                name: 'write',
                description: 'Creates new files or scaffolds content.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        intent: { type: 'string' },
                        profile: { type: 'string', enum: ['fast', 'balanced', 'deep'] },
                        safety: { type: 'string', enum: ['plan', 'apply'] },
                        targetPath: { type: 'string' },
                        template: { type: 'string' },
                        content: { type: 'string' },
                        dryRun: { type: 'boolean' },
                        sessionId: { type: 'string' },
                        trace: { type: 'boolean' },
                        stylePack: { anyOf: [{ type: 'string' }, { type: 'object' }] },
                        draftOptions: {
                            type: 'object',
                            properties: {
                                skeletonOnly: { type: 'boolean' },
                                includeImpact: { type: 'boolean' }
                            }
                        },
                        draftId: { type: 'string' },
                        refinement: { type: 'string' },
                        reviewOptions: {
                            type: 'object',
                            properties: {
                                preApply: { type: 'boolean' },
                                postApply: { type: 'boolean' },
                                strictness: { type: 'string', enum: ['strict', 'balanced', 'permissive'] },
                                blockOn: { type: 'array', items: { type: 'string', enum: ['syntax', 'semantic', 'guardrails', 'vibe'] } }
                            }
                        },
                        options: {
                            type: 'object',
                            properties: {
                                safeWrite: { type: 'boolean' },
                                quickGenerate: { type: 'boolean' },
                                smartWrite: { type: 'boolean' },
                                styleReference: { type: 'array', items: { type: 'string' } }
                            }
                        }
                    },
                    required: ['intent']
                }
            },
            {
                name: 'manage',
                description: 'Manages project state and transactions.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            enum: [
                                'status',
                                'undo',
                                'redo',
                                'reindex',
                                'rebuild',
                                'history',
                                'test',
                                'init',
                                'doctor',
                                'sessions',
                                'session',
                                'session_complete',
                                'session_update',
                                'artifacts',
                                'artifact',
                                'discard',
                                'prune',
                                'export',
                                'import'
                            ]
                        },
                        scope: { type: 'string', enum: ['file', 'transaction', 'project'] },
                        target: { type: 'string' },
                        limit: { type: 'number' },
                        outcome: { type: 'object' },
                        sessionId: { type: 'string' },
                        policy: { type: 'object' },
                        policyMode: { type: 'string', enum: ['merge', 'replace'] },
                        artifactOptions: {
                            type: 'object',
                            properties: {
                                type: { type: 'string' },
                                sessionId: { type: 'string' },
                                limit: { type: 'number' },
                                includeExpired: { type: 'boolean' }
                            }
                        },
                        mode: { type: 'string', enum: ['plan', 'apply'] },
                        targets: { type: 'array', items: { type: 'string', enum: ['kairo', 'vscode'] } },
                        root: { type: 'string' },
                        multiRepo: { type: 'string', enum: ['auto', 'single', 'detect'] },
                        presets: { type: 'string', enum: ['minimal', 'recommended'] },
                        languageScan: {
                            type: 'object',
                            properties: {
                                maxFiles: { type: 'number' },
                                sampleBytesPerFile: { type: 'number' },
                                includeDocs: { type: 'boolean' }
                            }
                        },
                        applyOptions: {
                            type: 'object',
                            properties: {
                                backup: { type: 'boolean' },
                                legacyMcpConfig: { type: 'boolean' }
                            }
                        }
                    },
                    required: ['command']
                }
            }
        ];

        const fileTools: any[] = [];
        const exposeInternalTools = process.env.KAIRO_EXPOSE_INTERNAL_TOOLS === "true"
            || process.env.KAIRO_EXPOSE_LEGACY_TOOLS === "true";
        const exposeFileTools = process.env.KAIRO_EXPOSE_FILE_TOOLS === "true"
            || process.env.KAIRO_EXPOSE_COMPAT_TOOLS === "true";
        if (exposeFileTools) {
            fileTools.push(
                {
                    name: 'file_read',
                    description: 'Returns Smart File Profile or raw file content.',
                    inputSchema: {
                        type: 'object',
                        properties: { filePath: { type: 'string' }, full: { type: 'boolean' } },
                        required: ['filePath']
                    }
                },
                {
                    name: 'file_write',
                    description: 'Writes or creates a file with provided content.',
                    inputSchema: {
                        type: 'object',
                        properties: { filePath: { type: 'string' }, content: { type: 'string' } },
                        required: ['filePath', 'content']
                    }
                },
                {
                    name: 'file_analyze',
                    description: 'Analyze a single file and return summary metadata.',
                    inputSchema: {
                        type: 'object',
                        properties: { filePath: { type: 'string' } },
                        required: ['filePath']
                    }
                }
            );
        }

        return [
            ...(exposeInternalTools ? internalTools : []),
            ...pillarTools,
            ...fileTools
        ];
    }

    private async handleCallTool(name: string, args: any): Promise<any> {
        const rolloutContext = this.buildRolloutContext(args);
        return FeatureFlags.withContext(rolloutContext, async () => {
            try {
                const useModularHandlers = FeatureFlags.isEnabled(FeatureFlags.MODULAR_HANDLERS_ENABLED, rolloutContext);
                if (useModularHandlers) {
                    const result = await this.handlerRegistry.handle(name, args);
                    if (result !== null) {
                        return result;
                    }
                } else {
                    const legacyResult = await this.handleCallToolLegacy(name, args);
                    if (legacyResult !== null) {
                        return legacyResult;
                    }
                }

                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
            } catch (error: any) {
                if (error instanceof McpError) {
                    throw error;
                }
                return this.errorResponse(error?.code ?? "InternalError", error?.message ?? "Unknown error", error?.details);
            }
        });
    }

    private async handleCallToolLegacy(name: string, args: any): Promise<any> {
        if (this.internalRegistry.hasTool(name)) {
            const result = await this.internalRegistry.execute(name, args);
            return this.wrapLegacyResult(result);
        }

        if (this.isPillarTool(name)) {
            const result = await this.orchestrationEngine.executePillar(name, args);
            return this.jsonResponse(result);
        }

        return null;
    }

    private wrapLegacyResult(result: any): any {
        if (result && typeof result === 'object' && Array.isArray(result.content)) {
            return result;
        }
        if (typeof result === 'string') {
            return this.textResponse(result);
        }
        return this.jsonResponse(result);
    }

    private isPillarTool(name: string): boolean {
        return name === 'explore'
            || name === 'understand'
            || name === 'change'
            || name === 'write'
            || name === 'manage'
            || name === 'navigate';
    }

    private validateRequiredArgs(toolName: string, args: any): string[] {
        const requiredMap: Record<string, string[]> = {
            code_read: ['filePath'],
            project_search: ['query'],
            file_search: [],
            file_read: ['filePath'],
            file_fragment_read: ['filePath'],
            relationship_analyze: ['target', 'mode'],
            edit_apply: ['edits'],
            file_edit: ['filePath', 'edits'],
            edit_guidance: ['filePaths'],
            project_manage: ['command'],
            interface_reconstruct: ['symbolName'],
            file_write: ['filePath', 'content'],
            file_analyze: ['filePath'],
            understand: ['goal'],
            explore: [],
            change: ['intent'],
            write: ['intent'],
            manage: ['command']
        };
        const required = requiredMap[toolName] || [];
        const missing: string[] = [];
        for (const key of required) {
            if (args?.[key] === undefined || args?.[key] === null) {
                missing.push(key);
            }
        }
        return missing;
    }

    private buildRolloutContext(args: any): FeatureFlagContext | undefined {
        const userId = this.resolveRolloutUser(args);
        if (!userId) return undefined;
        return { userId };
    }

    private resolveRolloutUser(args: any): string | undefined {
        const candidates: Array<unknown> = [];
        if (args && typeof args === 'object') {
            const candidatePaths: string[][] = [
                ['userId'],
                ['user', 'id'],
                ['user', 'email'],
                ['session', 'userId'],
                ['session', 'user', 'id'],
                ['metadata', 'userId'],
                ['metadata', 'user', 'id'],
                ['metadata', 'actor', 'id'],
                ['client', 'userId'],
                ['__client', 'userId'],
                ['__context', 'userId'],
                ['__metadata', 'userId'],
                ['__metadata', 'actor', 'id'],
                ['identity', 'userId'],
                ['actor', 'id']
            ];
            for (const path of candidatePaths) {
                candidates.push(this.extractNestedValue(args, path));
            }
            candidates.push(this.extractHeaderUser(args));
        }
        candidates.push(
            process.env.KAIRO_ROLLOUT_USER,
            process.env.KAIRO_USER_ID,
            process.env.KAIRO_DEFAULT_USER
        );
        return this.pickFirstString(...candidates);
    }

    private extractNestedValue(source: any, path: string[]): unknown {
        let current = source;
        for (const segment of path) {
            if (!current || typeof current !== 'object') {
                return undefined;
            }
            current = current[segment];
        }
        return current;
    }

    private extractHeaderUser(args: any): string | undefined {
        const headerSources = [args?.__headers, args?.headers];
        for (const headers of headerSources) {
            if (!headers || typeof headers !== 'object') continue;
            for (const key of Object.keys(headers)) {
                const lowered = key.toLowerCase();
                if (lowered === 'x-user-id' || lowered === 'x-slack-user' || lowered === 'x-github-user') {
                    const value = headers[key];
                    if (typeof value === 'string') {
                        const trimmed = value.trim();
                        if (trimmed) return trimmed;
                    }
                }
            }
        }
        return undefined;
    }

    private pickFirstString(...candidates: Array<unknown>): string | undefined {
        for (const candidate of candidates) {
            if (typeof candidate === 'string') {
                const trimmed = candidate.trim();
                if (trimmed.length > 0) {
                    return trimmed;
                }
            }
        }
        return undefined;
    }

    private jsonResponse(payload: any): any {
        return { content: [{ type: 'text', text: JSON.stringify(payload, this.jsonReplacer, 2) }] };
    }

    private jsonReplacer(_key: string, value: any): any {
        if (value instanceof Map) {
            return { __type: "Map", entries: Array.from(value.entries()) };
        }
        if (value instanceof Set) {
            return { __type: "Set", values: Array.from(value.values()) };
        }
        return value;
    }

    private textResponse(text: string): any {
        return { content: [{ type: 'text', text }] };
    }

    private errorResponse(errorCode: string, message: string, details?: any): any {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ errorCode, message, details }) }]
        };
    }

    private resolveRelativePath(inputPath: string): string {
        return this.pathNormalizer.normalize(inputPath);
    }

    private resolveAbsolutePath(inputPath: string): string {
        return this.pathNormalizer.toAbsolute(this.resolveRelativePath(inputPath));
    }


    public async shutdown() {
        this.stopHeartbeat();
        await this.server.close();
        this.clusterSearchEngine.stopBackgroundTasks();
        if (this.incrementalIndexer) {
            await this.incrementalIndexer.stop();
        }
        await this.searchEngine.dispose();
        await this.symbolIndex.dispose();
        await this.skeletonCache.close();
        await this.astManager.dispose();
        await this.configurationManager.dispose();
        this.repoRegistry.dispose();
        this.indexDatabase.close();
    }

    public async waitForInitialScan() {
        // Simple delay or bridge to incremental indexer
        return new Promise(resolve => setTimeout(resolve, 100));
    }

    public async run() {

        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error(`Kairo Server running on stdio (cwd=${process.cwd()})`);

        if (this.incrementalIndexer) {
            void this.incrementalIndexer.start().catch((error) => {
                console.error('[SmartContextServer] Incremental indexer failed to start:', error);
            });
        }
        
        // Background warmup: Start trigram index building without blocking
        // This improves search quality for subsequent requests
        if (!this.isTestEnv() && this.shouldWarmupSearchIndex()) {
            setImmediate(() => {
                this.searchEngine.warmup().catch((error) => {
                    console.error('[SmartContextServer] Background warmup failed:', error);
                });
            });
        }
    }
    // Final Verification: Configuration via .mcp-config.json successful!
}
