import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
    buildContractMeta,
    getToolSchemaMode,
    normalizeArgs,
    validateArgs
} from "./tools/ToolArgs.js";
import { createDefaultToolSpecRegistry, type ToolSpec } from "./tools/ToolSpecRegistry.js";
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
import { StorageMaintenanceService, type StoragePruneTarget } from "../indexing/StorageMaintenanceService.js";
import { TransactionLog } from "../engine/TransactionLog.js";
import { PatchStore } from "../engine/PatchStore.js";
import { ConfigurationManager } from "../config/ConfigurationManager.js";
import { RepoRegistry } from "../config/RepoRegistry.js";
import { PackageAliasMap } from "../config/PackageAliasMap.js";
import { GraphRagConfigLoader } from "../config/GraphRagConfig.js";
import { PropertyAccessIndex } from "../ast/PropertyAccessIndex.js";
import { FieldAccessIndex } from "../ast/FieldAccessIndex.js";
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
import { resolveEmbeddingConfigFromEnv, resolveEmbeddingProviderEnv } from "../embeddings/EmbeddingConfig.js";
import { metrics } from "../utils/MetricsCollector.js";
import { VectorIndexManager } from "../vector/VectorIndexManager.js";
import { SymbolEmbeddingIndex } from "../indexing/SymbolEmbeddingIndex.js";
import { AdaptiveFlowReporter } from "../utils/AdaptiveFlowReporter.js";
import { AlertDispatcher } from "../utils/AlertDispatcher.js";
import { AdaptiveLodController } from "../orchestration/adaptive-flow/AdaptiveLodController.js";
import { MetricsExportService } from "../utils/metrics/MetricsExportService.js";
import { CacheInvalidationHub } from "./CacheInvalidationHub.js";
import { BoundaryAdapterRegistry } from "../contracts/BoundaryAdapterRegistry.js";
import { ContractRegistry } from "../contracts/ContractRegistry.js";
import { resolveLogToFileEnabled, resolvePublicSurface } from "../orchestration/policy/McpModePresetRegistry.js";
import { BetaTelemetryLogger, type BetaTelemetryEvent } from "../utils/BetaTelemetryLogger.js";

// Orchestration Imports
import { OrchestrationEngine } from "../orchestration/OrchestrationEngine.js";
import { IntentRouter } from "../orchestration/IntentRouter.js";
import { WorkflowPlanner } from "../orchestration/WorkflowPlanner.js";
import { InternalToolRegistry } from "../orchestration/InternalToolRegistry.js";
import { CachingStrategy } from "../orchestration/CachingStrategy.js";
import { FlowArtifactManager } from "../orchestration/flow-artifact-manager.js";
import { estimateTokens } from "../orchestration/TokenBudget.js";
import { hashContent } from "../utils/hash.js";

// Handler Imports
import { SearchHandlers } from "../handlers/SearchHandlers.js";
import { CodeHandlers } from "../handlers/CodeHandlers.js";
import { EditHandlers } from "../handlers/EditHandlers.js";
import { DocumentHandlers } from "../handlers/DocumentHandlers.js";
import { ManageHandlers } from "../handlers/ManageHandlers.js";
import { NavigateHandlers } from "../handlers/NavigateHandlers.js";
import { IntegrityHandlers } from "../handlers/IntegrityHandlers.js";
import { HandlerRegistry } from "../handlers/HandlerRegistry.js";
import { createHandlerContext, type HandlerContext } from "../handlers/HandlerContext.js";
import { TaskHandlers } from "../handlers/TaskHandlers.js";

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
    private boundaryAdapterRegistry: BoundaryAdapterRegistry;
    private contractRegistry: ContractRegistry;
    private graphRagConfig: GraphRagConfigLoader;
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
    private symbolEmbeddingIndex?: SymbolEmbeddingIndex;
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
    private storagePruneTimer?: NodeJS.Timeout;
    private storagePruneRunning = false;
    private metricsReporter?: AdaptiveFlowReporter;
    private alertDispatcher?: AlertDispatcher;
    private metricsExportService?: MetricsExportService;
    private cacheInvalidationHub?: CacheInvalidationHub;
    private cacheStrategy: CachingStrategy;
    private toolSpecRegistry = createDefaultToolSpecRegistry();
    private handlerContext?: HandlerContext;
    private vectorIndexInitPromise?: Promise<void>;
    private betaTelemetry?: BetaTelemetryLogger;

    private searchHandlers!: SearchHandlers;
    private codeHandlers!: CodeHandlers;
    private editHandlers!: EditHandlers;
    private documentHandlers!: DocumentHandlers;
    private manageHandlers!: ManageHandlers;
    private navigateHandlers!: NavigateHandlers;
    private integrityHandlers!: IntegrityHandlers;
    private taskHandlers!: TaskHandlers;
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
        this.betaTelemetry = BetaTelemetryLogger.fromEnv(this.rootPath);
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
        this.graphRagConfig = new GraphRagConfigLoader(this.rootPath);
        this.repoRegistry = new RepoRegistry(this.rootPath);
        this.boundaryAdapterRegistry = BoundaryAdapterRegistry.createDefault(this.rootPath, this.repoRegistry);
        this.contractRegistry = new ContractRegistry(this.rootPath, this.repoRegistry);
        for (const adapter of this.boundaryAdapterRegistry.getAll()) {
            this.contractRegistry.registerAdapter(adapter);
        }
        const packageAliasMap = new PackageAliasMap(this.repoRegistry);
        packageAliasMap.build();
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
        this.vectorIndexInitPromise = this.vectorIndexManager
            .initializeFromEmbeddingConfig(this.embeddingProviderFactory.getConfig())
            .catch((error) => {
                if (!this.isTestEnv()) {
                    console.warn("[SmartContextServer] Vector index initialization failed:", error);
                }
            });
        this.documentProfiler = new DocumentProfiler(this.rootPath);
        this.documentIndexer = new DocumentIndexer(this.rootPath, this.fileSystem, this.indexDatabase, {
            embeddingRepository: this.embeddingRepository,
            embeddingProviderFactory: this.embeddingProviderFactory,
            vectorIndexManager: this.vectorIndexManager
        });
        this.symbolIndex = new SymbolIndex(this.rootPath, this.skeletonGenerator, initialIgnorePatterns, this.indexDatabase);
        this.moduleResolver = new ModuleResolver({ rootPath: this.rootPath, packageAliasMap });
        this.dependencyGraph = new DependencyGraph(this.rootPath, this.symbolIndex, this.moduleResolver, this.indexDatabase);
        this.callGraphBuilder = new CallGraphBuilder(this.rootPath, this.symbolIndex, this.moduleResolver);
        this.typeDependencyTracker = new TypeDependencyTracker(this.rootPath, this.symbolIndex);
        this.dataFlowTracer = new DataFlowTracer(this.rootPath, this.symbolIndex, this.fileSystem);
        const propertyAccessIndex = new PropertyAccessIndex(this.rootPath);
        const fieldAccessIndex = new FieldAccessIndex(this.rootPath, { propertyAccessIndex });
        this.impactAnalyzer = new ImpactAnalyzer(this.dependencyGraph, this.callGraphBuilder, this.symbolIndex, undefined, fieldAccessIndex);
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
                initialScan: this.resolveBaselineEnabled(),
                onFileQueued: (filePath) => {
                    this.indexStateManager.markDirty(toRelative(filePath));
                    this.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath: filePath });
                },
                onFileIndexed: (filePath) => {
                    this.indexStateManager.clearDirty(toRelative(filePath));
                    if (this.symbolEmbeddingIndex?.isReadyForIncremental()) {
                        void (async () => {
                            try {
                                const stat = await this.fileSystem.stat(filePath).catch(() => undefined);
                                await this.symbolEmbeddingIndex!.indexSymbolsForFile(filePath, { mtime: stat?.mtime });
                            } catch (error) {
                                console.warn("[SmartContextServer] Symbol incremental index failed:", error);
                            }
                        })();
                    }
                },
                onFileRemoved: (filePath) => {
                    this.indexStateManager.clearDirty(toRelative(filePath));
                    this.cacheInvalidationHub?.onEvent({ type: "file_deleted", absPath: filePath });
                    if (this.symbolEmbeddingIndex?.isReadyForIncremental()) {
                        void this.symbolEmbeddingIndex.clearSymbolsForFile(filePath).catch((error) => {
                            console.warn("[SmartContextServer] Symbol incremental clear failed:", error);
                        });
                    }
                },
                onDirectoryRemoved: (dirPath) => {
                    this.cacheInvalidationHub?.onEvent({ type: "dir_deleted", absPath: dirPath });
                },
                onActivity: (activity) => {
                    this.indexStateManager.setActivity(activity);
                }
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
            this.vectorIndexManager,
            this.indexDatabase
        );
        this.clusterSearchEngine = new ClusterSearchEngine({
            rootPath: this.rootPath,
            symbolIndex: this.symbolIndex,
            callGraphBuilder: this.callGraphBuilder,
            typeDependencyTracker: this.typeDependencyTracker,
            dependencyGraph: this.dependencyGraph,
            fileSystem: this.fileSystem
        });
        if (!this.isTestEnv()) {
            this.graphRagConfig.watch(() => {
                this.clusterSearchEngine.clearCache();
            });
        }

        this.cacheStrategy = new CachingStrategy(this.rootPath);
        this.cacheInvalidationHub = new CacheInvalidationHub({
            rootPath: this.rootPath,
            indexStateManager: this.indexStateManager,
            searchEngine: this.searchEngine,
            dependencyGraph: this.dependencyGraph,
            clusterSearchEngine: this.clusterSearchEngine,
            documentSearchEngine: this.documentSearchEngine,
            documentIndexer: this.documentIndexer,
            orchestrationCache: this.cacheStrategy,
            callGraphBuilder: this.callGraphBuilder,
            typeDependencyTracker: this.typeDependencyTracker
        });
        void this.cacheInvalidationHub.syncEpoch();

        const historyEngine = new HistoryEngine(this.rootPath, this.fileSystem);
        this.historyEngine = historyEngine;
        const editorEngine = new EditorEngine(this.rootPath, this.fileSystem, new AstAwareDiff(this.skeletonGenerator));
        const transactionLog = new TransactionLog(this.indexDatabase, new PatchStore());

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
        this.flowArtifactManager = new FlowArtifactManager({
            persistPath: PathManager.resolve("flow-artifacts"),
            fileSystem: this.fileSystem
        });
        this.orchestrationEngine = new OrchestrationEngine(
            new IntentRouter(),
            new WorkflowPlanner(),
            this.internalRegistry,
            this.cacheStrategy
        );
        this.registerInternalTools();
        
        // Store searchEngine reference for pillars to access
        this.internalRegistry.setMetadata('searchEngine', this.searchEngine);
        this.internalRegistry.setMetadata('indexStateManager', this.indexStateManager);
        this.internalRegistry.setMetadata('dependencyGraph', this.dependencyGraph);
        this.internalRegistry.setMetadata('flowArtifactManager', this.flowArtifactManager);
        this.internalRegistry.setMetadata('rootPath', this.rootPath);
        this.internalRegistry.setMetadata('repoRegistry', this.repoRegistry);
        this.internalRegistry.setMetadata('boundaryAdapterRegistry', this.boundaryAdapterRegistry);
        this.internalRegistry.setMetadata('contractRegistry', this.contractRegistry);
        this.internalRegistry.setMetadata('pathNormalizer', this.pathNormalizer);
        this.internalRegistry.setMetadata('packageAliasMap', packageAliasMap);
        this.internalRegistry.setMetadata('impactAnalyzer', this.impactAnalyzer);
        this.internalRegistry.setMetadata('propertyAccessIndex', propertyAccessIndex);
        this.internalRegistry.setMetadata('fileVersionManager', this.fileVersionManager);
        this.internalRegistry.setMetadata('adaptiveLodController', new AdaptiveLodController());
        this.internalRegistry.setMetadata('clusterSearchEngine', this.clusterSearchEngine);
        this.internalRegistry.setMetadata('symbolIndex', this.symbolIndex);
        this.internalRegistry.setMetadata('graphRagConfig', this.graphRagConfig);
        
        this.setupHandlers();
        this.initializeModularHandlers();
        this.setupShutdownHooks();

        this.startHeartbeat();
        this.initMetricsReporter();
        this.initMetricsExportService();
        this.startStoragePrune();
        void this.initSymbolSemanticSearch();
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
            symbolEmbeddingIndex: this.symbolEmbeddingIndex,
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
            metricsExportService: this.metricsExportService,
            cacheInvalidationHub: this.cacheInvalidationHub,
            toolSpecRegistry: this.toolSpecRegistry,
            isTestEnv: () => this.isTestEnv()
        });
        this.handlerContext = handlerContext;
        this.searchHandlers = new SearchHandlers(handlerContext);
        this.codeHandlers = new CodeHandlers(handlerContext);
        this.editHandlers = new EditHandlers(handlerContext);
        this.documentHandlers = new DocumentHandlers(handlerContext);
        this.manageHandlers = new ManageHandlers(handlerContext);
        this.navigateHandlers = new NavigateHandlers(handlerContext);
        this.integrityHandlers = new IntegrityHandlers(handlerContext);
        this.taskHandlers = new TaskHandlers(handlerContext);

        this.handlerRegistry.register(this.searchHandlers);
        this.handlerRegistry.register(this.codeHandlers);
        this.handlerRegistry.register(this.editHandlers);
        this.handlerRegistry.register(this.documentHandlers);
        this.handlerRegistry.register(this.manageHandlers);
        this.handlerRegistry.register(this.navigateHandlers);
        this.handlerRegistry.register(this.integrityHandlers);
        this.handlerRegistry.register(this.taskHandlers);
    }

    private isTestEnv(): boolean {

        return process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID != null;
    }

    private registerInternalTools(): void {
        this.internalRegistry.register('code_read', (args) => (this.codeHandlers as any).readCodeRaw(args));
        this.internalRegistry.register('project_search', (args) => (this.searchHandlers as any).searchProjectRaw(args));
        this.internalRegistry.register('symbol_semantic_search', (args) => (this.searchHandlers as any).searchSymbolSemanticRaw(args));
        this.internalRegistry.register('file_search', (args) => (this.searchHandlers as any).searchFilesRaw(args));
        this.internalRegistry.register('file_scout', (args) => (this.searchHandlers as any).scoutFilesRaw(args));
        this.internalRegistry.register('file_list', (args) => (this.codeHandlers as any).listFilesRaw(args));
        this.internalRegistry.register('file_stat', (args) => (this.codeHandlers as any).statFileRaw(args));
        this.internalRegistry.register('relationship_analyze', (args) => (this.codeHandlers as any).analyzeRelationshipRaw(args));
        this.internalRegistry.register('edit_apply', (args) => (this.editHandlers as any).editCodeRaw(args));
        this.internalRegistry.register('file_edit', (args) => (this.editHandlers as any).editFileRaw(args));
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
        const enabled = resolveLogToFileEnabled() || !!process.env.KAIRO_LOG_FILE;
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

    private startStoragePrune(): void {
        if (this.storagePruneTimer || this.isTestEnv()) return;
        const intervalMs = Number(process.env.KAIRO_STORAGE_PRUNE_INTERVAL_MS ?? "");
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
        const includeOnStart = process.env.KAIRO_STORAGE_PRUNE_ON_START === "true";
        const includeFlowArtifacts = process.env.KAIRO_STORAGE_PRUNE_FLOW_ARTIFACTS === "true";
        const compact = process.env.KAIRO_STORAGE_PRUNE_COMPACT === "true";

        const runPrune = async () => {
            if (this.storagePruneRunning) return;
            this.storagePruneRunning = true;
            try {
                const targets: StoragePruneTarget[] = includeFlowArtifacts
                    ? ["evidence_packs", "chunk_summaries", "flow_artifacts"]
                    : ["evidence_packs", "chunk_summaries"];
                const service = new StorageMaintenanceService(
                    this.indexDatabase,
                    this.documentSearchEngine,
                    this.flowArtifactManager
                );
                await service.prune({
                    mode: "apply",
                    targets,
                    includeExpired: true,
                    includeStale: true,
                    enforceCaps: true,
                    compact
                });
            } catch (error) {
                console.warn("[SmartContextServer] Background storage prune failed:", error);
            } finally {
                this.storagePruneRunning = false;
            }
        };

        this.storagePruneTimer = setInterval(runPrune, intervalMs);
        if (includeOnStart) {
            setImmediate(() => {
                void runPrune();
            });
        }
    }

    private stopStoragePrune(): void {
        if (!this.storagePruneTimer) return;
        clearInterval(this.storagePruneTimer);
        this.storagePruneTimer = undefined;
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

    private initMetricsExportService(): void {
        if (this.isTestEnv()) return;
        const service = new MetricsExportService();
        this.metricsExportService = service;
        void service.start().catch((error) => {
            console.warn("[SmartContextServer] Metrics export service failed to start:", error);
        });
    }

    private async initSymbolSemanticSearch(): Promise<void> {
        const enabled = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_ENABLED ?? "false").toLowerCase() === "true";
        const mode = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_MODE ?? "manual").toLowerCase();
        if (!enabled || mode === "off") {
            return;
        }
        const embeddingConfig = this.embeddingProviderFactory.getConfig();
        const providerEnv = resolveEmbeddingProviderEnv(embeddingConfig).provider;
        const baseModel = embeddingConfig.local?.model ?? "multilingual-e5-small";
        if (providerEnv === "disabled" || baseModel === "hash" || baseModel.startsWith("hash-")) {
            return;
        }
        try {
            const provider = await this.embeddingProviderFactory.getProvider();
            if (provider.provider === "disabled" || provider.model === "hash") {
                return;
            }
            const symbolModelKey = process.env.KAIRO_SYMBOL_EMBEDDING_MODEL_KEY
                ?? `${provider.model}::symbols_v1`;
            this.symbolEmbeddingIndex = new SymbolEmbeddingIndex(
                this.symbolIndex,
                this.vectorIndexManager,
                this.embeddingRepository,
                provider,
                {
                    enabled: true,
                    mode: mode === "manual" ? "manual" : "off",
                    batchSize: this.parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_BATCH_SIZE, 10),
                    minSimilarity: this.parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MIN_SIMILARITY, 0.5),
                    maxResults: this.parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_RESULTS, 20),
                    maxTextChars: this.parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_TEXT_CHARS, 2000),
                    maxFiles: this.parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_FILES, 2000),
                    maxSymbols: this.parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_SYMBOLS, 20000),
                    maxBytesPerSymbol: this.parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_MAX_BYTES_PER_SYMBOL, 4000),
                    timeoutMs: this.parseNumberEnv(process.env.KAIRO_SYMBOL_EMBEDDINGS_TIMEOUT_MS, 60000),
                    symbolModelKey
                }
            );
            this.searchEngine.setSymbolEmbeddingIndex(this.symbolEmbeddingIndex);
            if (this.handlerContext) {
                this.handlerContext.symbolEmbeddingIndex = this.symbolEmbeddingIndex;
            }
            this.internalRegistry.setMetadata('symbolEmbeddingIndex', this.symbolEmbeddingIndex);
        } catch (error) {
            console.warn("[SmartContextServer] Symbol semantic search init failed:", error);
        }
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

    private resolveBaselineEnabled(): boolean {
        const raw = (process.env.KAIRO_BASELINE_ENABLED ?? "auto").toLowerCase();
        if (raw === "off" || raw === "false" || raw === "0") return false;
        if (raw === "on" || raw === "true" || raw === "1") return true;
        return !this.isTestEnv();
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
        this.cacheInvalidationHub?.onEvent({ type: "ignore_changed" });
    }

    private listIntentTools(): any[] {
        const exposeInternalTools = process.env.KAIRO_EXPOSE_INTERNAL_TOOLS === "true"
            || process.env.KAIRO_EXPOSE_LEGACY_TOOLS === "true";
        const exposeFileTools = process.env.KAIRO_EXPOSE_FILE_TOOLS === "true"
            || process.env.KAIRO_EXPOSE_COMPAT_TOOLS === "true";
        const tools = this.toolSpecRegistry.listTools({
            exposeInternal: exposeInternalTools,
            exposeCompat: exposeFileTools
        });
        const surface = resolvePublicSurface();
        const compactToolNames = new Set(["task", "manage"]);
        const filtered = surface === "compact" && !exposeInternalTools && !exposeFileTools
            ? tools.filter((tool) => compactToolNames.has(tool.name))
            : tools;
        return filtered.map((tool: ToolSpec) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
        }));
    }

    private async handleCallTool(name: string, args: any): Promise<any> {
        const rolloutContext = this.buildRolloutContext(args);
        return FeatureFlags.withContext(rolloutContext, async () => {
            this.recordToolCallTelemetry(name);
            const startedAt = Date.now();
            const finalizeResponse = (response: any) => {
                this.ensureResponseHasIsError(response);
                this.recordResponseTelemetry(name, response);
                this.recordBetaTelemetry(name, args, response, startedAt);
                return response;
            };
            try {
                const toolSpec = this.toolSpecRegistry.get(name);
                const mode = getToolSchemaMode();
                const normalized = toolSpec ? normalizeArgs(toolSpec, args, mode) : { args: args ?? {}, findings: [], droppedFields: [] };
                if (toolSpec) {
                    const validation = validateArgs(toolSpec, normalized.args, mode);
                    if (validation.missing.length > 0) {
                        return finalizeResponse(this.errorResponse("MissingParameter", `Missing required parameter(s): ${validation.missing.join(", ")}`));
                    }
                    if (validation.invalid.length > 0) {
                        return finalizeResponse(this.errorResponse("InvalidArguments", "Invalid arguments.", { invalid: validation.invalid }));
                    }
                }
                const useModularHandlers = FeatureFlags.isEnabled(FeatureFlags.MODULAR_HANDLERS_ENABLED, rolloutContext);
                let result: any | null = null;
                if (useModularHandlers) {
                    const handlerResult = await this.handlerRegistry.handle(name, normalized.args);
                    if (handlerResult !== null) {
                        result = this.attachContractMeta(handlerResult, toolSpec, mode, normalized);
                    }
                } else {
                    const legacyResult = await this.handleCallToolLegacy(name, normalized.args);
                    if (legacyResult !== null) {
                        result = this.attachContractMeta(legacyResult, toolSpec, mode, normalized);
                    }
                }
                if (result !== null) {
                    return finalizeResponse(result);
                }
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
            } catch (error: any) {
                if (error instanceof McpError) {
                    throw error;
                }
                return finalizeResponse(this.errorResponse(error?.code ?? "InternalError", error?.message ?? "Unknown error", error?.details));
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
        let response: any;
        if (result && typeof result === 'object' && Array.isArray(result.content)) {
            response = result;
        } else if (typeof result === 'string') {
            response = this.textResponse(result);
        } else {
            response = this.jsonResponse(result);
        }
        const derivedError = this.deriveLegacyIsError(result);
        if (typeof derivedError === "boolean" && response && typeof response === "object") {
            if (response.isError === undefined) {
                response.isError = derivedError;
            }
        }
        return response;
    }

    private deriveLegacyIsError(result: any): boolean | undefined {
        if (!result || typeof result !== "object") {
            return undefined;
        }
        if (typeof result.isError === "boolean") {
            return result.isError;
        }
        if (typeof result.success === "boolean") {
            return !result.success;
        }
        if (typeof result.errorCode === "string") {
            return true;
        }
        return undefined;
    }

    private attachContractMeta(
        result: any,
        toolSpec: ToolSpec | undefined,
        mode: "compat" | "strict",
        normalized: { args: Record<string, any>; findings: import("./tools/ToolArgs.js").CompatFinding[] }
    ): any {
        if (!toolSpec) return result;
        if (!result || typeof result !== "object" || !Array.isArray(result.content)) {
            return result;
        }
        const text = result.content?.[0]?.text;
        if (typeof text !== "string") return result;
        let payload: any;
        try {
            payload = JSON.parse(text);
        } catch {
            return result;
        }
        if (!payload || typeof payload !== "object") return result;
        if (payload.isError) return result;

        const contract = buildContractMeta(toolSpec, mode, normalized.findings, normalized.args);
        payload.contract = contract;
        if (Array.isArray(contract.findings) && contract.findings.length > 0 && payload.guidance) {
            const warnings = contract.findings.map((finding) => ({
                severity: finding.severity,
                code: finding.code,
                message: finding.message,
                affectedTargets: undefined,
                mitigation: undefined
            }));
            if (Array.isArray(payload.guidance.warnings)) {
                payload.guidance.warnings.push(...warnings);
            } else {
                payload.guidance.warnings = warnings;
            }
        }
        return this.jsonResponse(payload);
    }

    private ensureResponseHasIsError(response: any): void {
        if (!response || typeof response !== "object") return;
        if (typeof response.isError === "boolean") return;
        if (typeof response.success === "boolean") {
            response.isError = response.success === false;
            return;
        }
        const text = response.content?.[0]?.text;
        if (typeof text !== "string") return;
        try {
            const payload = JSON.parse(text);
            if (!payload || typeof payload !== "object") return;
            if (typeof payload.isError === "boolean") {
                response.isError = payload.isError;
                return;
            }
            if (typeof payload.success === "boolean") {
                response.isError = payload.success === false;
                return;
            }
            if (typeof payload.errorCode === "string") {
                response.isError = true;
            }
        } catch {
            // ignore parsing errors
        }
    }

    private recordToolCallTelemetry(name: string): void {
        const toolName = typeof name === "string" && name.trim().length > 0 ? name.trim() : "unknown";
        metrics.inc("tool.calls_total");
        metrics.inc(`tool.calls.${toolName}`);
    }

    private recordResponseTelemetry(name: string, response: any): void {
        try {
            const text = this.extractResponseText(response);
            if (!text) return;
            const toolName = typeof name === "string" && name.trim().length > 0 ? name.trim() : "unknown";
            const usedChars = text.length;
            metrics.observe("response.envelope.chars", usedChars);
            metrics.observe(`response.envelope.chars.${toolName}`, usedChars);
            const estimatedTokens = estimateTokens(text, { languageId: "json" });
            metrics.observe("response.envelope.tokens", estimatedTokens);
            metrics.observe(`response.envelope.tokens.${toolName}`, estimatedTokens);
            const degradedReasons = this.extractDegradedReasonTypes(text);
            for (const reason of degradedReasons) {
                metrics.inc(`degraded.reason.${reason}`);
            }
        } catch {
            // ignore telemetry failures
        }
    }

    private recordBetaTelemetry(name: string, args: any, response: any, startedAt: number): void {
        if (!this.betaTelemetry) return;
        try {
            const toolName = typeof name === "string" && name.trim().length > 0 ? name.trim() : "unknown";
            const text = this.extractResponseText(response);
            const responseChars = text?.length ?? 0;
            const responseTokens = text ? estimateTokens(text, { languageId: "json" }) : undefined;
            const payload = this.safeParsePayload(text);
            const event: BetaTelemetryEvent = {
                tool: toolName,
                surface: resolvePublicSurface(),
                latencyMs: Math.max(0, Date.now() - startedAt),
                responseChars: responseChars > 0 ? responseChars : undefined,
                responseTokens,
                status: this.resolvePayloadStatus(payload, response),
                errorCode: this.resolvePayloadErrorCode(payload, response),
                degraded: typeof payload?.degraded === "boolean" ? payload.degraded : undefined,
                degradedReasons: Array.isArray(payload?.degradedReasons) ? payload.degradedReasons : undefined,
                contractFindingCodes: this.extractContractFindingCodes(payload),
                ...this.buildBetaInputSummary(toolName, args)
            };
            this.betaTelemetry.record(event);
        } catch {
            // ignore beta telemetry failures
        }
    }

    private safeParsePayload(text?: string): any | undefined {
        if (!text) return undefined;
        const trimmed = text.trim();
        if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
            return undefined;
        }
        if (trimmed.length > 200_000) {
            return undefined;
        }
        try {
            return JSON.parse(trimmed);
        } catch {
            return undefined;
        }
    }

    private resolvePayloadStatus(payload: any, response: any): "ok" | "error" | undefined {
        if (payload?.ok === true || payload?.success === true) return "ok";
        if (payload?.ok === false || payload?.success === false) return "error";
        if (response?.isError === true) return "error";
        return undefined;
    }

    private resolvePayloadErrorCode(payload: any, response: any): string | undefined {
        if (typeof payload?.errorCode === "string") return payload.errorCode;
        if (typeof payload?.result?.errorCode === "string") return payload.result.errorCode;
        const text = response?.content?.[0]?.text;
        if (typeof text === "string" && text.includes("MissingParameter")) return "MissingParameter";
        return undefined;
    }

    private extractContractFindingCodes(payload: any): string[] | undefined {
        const findings = payload?.contract?.findings;
        if (!Array.isArray(findings)) return undefined;
        const codes = findings
            .map((entry: any) => entry?.code)
            .filter((code: any) => typeof code === "string") as string[];
        return codes.length > 0 ? codes.slice(0, 8) : undefined;
    }

    private buildBetaInputSummary(toolName: string, args: any): Partial<BetaTelemetryEvent> {
        if (!args || typeof args !== "object") return {};
        const summary: Partial<BetaTelemetryEvent> = {};
        if (toolName === "task") {
            summary.mode = typeof args.mode === "string" ? args.mode : undefined;
            summary.budget = typeof args.budget === "string" ? args.budget : undefined;
            summary.outputFormat = typeof args.output?.format === "string" ? args.output.format : undefined;
            if (typeof args.request === "string" && args.request.trim().length > 0) {
                summary.requestHash = hashContent(args.request.trim());
            }
        } else if (typeof args.goal === "string" && args.goal.trim().length > 0) {
            summary.requestHash = hashContent(args.goal.trim());
        } else if (typeof args.intent === "string" && args.intent.trim().length > 0) {
            summary.requestHash = hashContent(args.intent.trim());
        } else if (typeof args.query === "string" && args.query.trim().length > 0) {
            summary.requestHash = hashContent(args.query.trim());
        }

        summary.editsCount = Array.isArray(args.edits) ? args.edits.length : undefined;
        summary.pathsCount = Array.isArray(args.paths) ? args.paths.length : undefined;
        summary.targetFilesCount = Array.isArray(args.targetFiles) ? args.targetFiles.length : undefined;
        return summary;
    }

    private extractResponseText(response: any): string | undefined {
        if (!response || typeof response !== "object") return undefined;
        const content = (response as any).content;
        if (!Array.isArray(content)) return undefined;
        const parts: string[] = [];
        for (const item of content) {
            if (item?.type === "text" && typeof item.text === "string") {
                parts.push(item.text);
            }
        }
        return parts.length > 0 ? parts.join("\n") : undefined;
    }

    private extractDegradedReasonTypes(text: string): string[] {
        const trimmed = text.trim();
        if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
            return [];
        }
        let payload: any;
        try {
            payload = JSON.parse(trimmed);
        } catch {
            return [];
        }
        return this.collectDegradedReasonTypes(payload);
    }

    private collectDegradedReasonTypes(payload: any): string[] {
        const seen = new Set<string>();
        const stack: any[] = [payload];
        let guard = 0;
        while (stack.length > 0 && guard < 500) {
            const current = stack.pop();
            guard += 1;
            if (!current || typeof current !== "object") continue;
            if (Array.isArray(current)) {
                const limit = Math.min(current.length, 50);
                for (let i = 0; i < limit; i += 1) {
                    const entry = current[i];
                    if (entry && typeof entry === "object") {
                        stack.push(entry);
                    }
                }
                continue;
            }
            const degradedSets = [
                (current as any).degradedReasons,
                (current as any).degradedReasonDetails
            ];
            for (const reasons of degradedSets) {
                if (!Array.isArray(reasons)) continue;
                for (const entry of reasons) {
                    if (typeof entry === "string" && entry.trim().length > 0) {
                        seen.add(entry.trim());
                        continue;
                    }
                    if (entry && typeof entry === "object") {
                        const type = (entry as any).type ?? (entry as any).code ?? (entry as any).reason;
                        if (typeof type === "string" && type.trim().length > 0) {
                            seen.add(type.trim());
                        }
                    }
                }
            }
            const values = Object.values(current);
            const limit = Math.min(values.length, 50);
            for (let i = 0; i < limit; i += 1) {
                const value = values[i];
                if (value && typeof value === "object") {
                    stack.push(value);
                }
            }
        }
        return Array.from(seen);
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
        const toolSpec = this.toolSpecRegistry.get(toolName);
        const required = Array.isArray(toolSpec?.inputSchema?.required) ? toolSpec?.inputSchema?.required ?? [] : [];
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
        this.stopStoragePrune();
        if (this.metricsExportService) {
            await this.metricsExportService.stop();
        }
        await this.server.close();
        this.clusterSearchEngine.stopBackgroundTasks();
        if (this.incrementalIndexer) {
            await this.incrementalIndexer.stop();
        }
        if (this.vectorIndexInitPromise) {
            await this.vectorIndexInitPromise;
        }
        await this.searchEngine.dispose();
        await this.symbolIndex.dispose();
        await this.skeletonCache.close();
        await this.astManager.dispose();
        await this.configurationManager.dispose();
        this.graphRagConfig.dispose();
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
    // Final Verification: Configuration via .kairo/config/.mcp-config.json successful!
}
