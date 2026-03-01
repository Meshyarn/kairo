import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ReadResourceRequestSchema,
    McpError,
    ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { createDefaultToolSpecRegistry } from "./tools/ToolSpecRegistry.js";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import {
    initFileLogger,
    initProcessDiagnostics,
    shouldWarmupSearchIndex,
    startHeartbeat,
    startStoragePrune,
    stopHeartbeat,
    stopStoragePrune,
    setupShutdownHooks
} from "./SmartContextServerRuntime.js";
import {
    recordBetaTelemetry,
    recordResponseTelemetry,
    recordToolCallTelemetry
} from "./SmartContextServerTelemetry.js";
import {
    applyIgnorePatterns,
    createIgnoreFilter,
    listIntentTools,
    validateRequiredArgs
} from "./SmartContextServerTooling.js";
import { parseNumberEnv, resolveAlertSeverity } from "./SmartContextServerEnv.js";
import { bootstrapSmartContextServer } from "./SmartContextServerBootstrap.js";
import { handleCallTool as dispatchToolCall } from "./SmartContextServerToolDispatch.js";
import { initMetricsReporter, initMetricsExportService } from "./SmartContextServerMetrics.js";
import { initSymbolSemanticSearch } from "./SmartContextServerSymbolSearch.js";
import { isDangerouslyBroadRoot } from "./StartupRootResolver.js";

const require = createRequire(import.meta.url);

const resolvePackageVersion = (): string => {
    try {
        const pkg = require("../../package.json");
        const version = typeof pkg?.version === "string" ? pkg.version.trim() : "";
        if (version.length > 0) {
            return version;
        }
    } catch {
        // ignore
    }

    const envVersion = (process.env.npm_package_version ?? "").trim();
    if (envVersion.length > 0) {
        return envVersion;
    }
    return "unknown";
};

const SERVER_VERSION = resolvePackageVersion();

// Engine Imports
import { SearchEngine } from "../engine/Search.js";
import { NativeSearchCore } from "../engine/search/native/NativeSearchCore.js";
import { NativeSearchIndexer } from "../engine/search/native/NativeSearchIndexer.js";
import { HistoryEngine } from "../engine/History.js";
import { ImpactAnalyzer } from "../engine/ImpactAnalyzer.js";
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
import { ConfigurationManager } from "../config/ConfigurationManager.js";
import { RepoRegistry } from "../config/RepoRegistry.js";
import { GraphRagConfigLoader } from "../config/GraphRagConfig.js";
import { PathNormalizer } from "../utils/PathNormalizer.js";
import { NodeFileSystem } from "../platform/FileSystem.js";
import { GhostInterfaceBuilder } from "../resolution/GhostInterfaceBuilder.js";
import { FallbackResolver } from "../resolution/FallbackResolver.js";
import { HotSpotDetector } from "../engine/ClusterSearch/HotSpotDetector.js";
import { ReferenceFinder } from "../ast/ReferenceFinder.js";
import { DocumentProfiler } from "../documents/DocumentProfiler.js";
import { DocumentSearchEngine } from "../documents/search/DocumentSearchEngine.js";
import { EmbeddingProviderFactory } from "../embeddings/EmbeddingProviderFactory.js";
import { VectorIndexManager } from "../vector/VectorIndexManager.js";
import type { SymbolEmbeddingIndex } from "../indexing/SymbolEmbeddingIndex.js";
import type { AdaptiveFlowReporter } from "../utils/AdaptiveFlowReporter.js";
import type { AlertDispatcher } from "../utils/AlertDispatcher.js";
import type { MetricsExportService } from "../utils/metrics/MetricsExportService.js";
import { CacheInvalidationHub } from "./CacheInvalidationHub.js";
import { BoundaryAdapterRegistry } from "../contracts/BoundaryAdapterRegistry.js";
import { ContractRegistry } from "../contracts/ContractRegistry.js";
import { BetaTelemetryLogger } from "../utils/BetaTelemetryLogger.js";

// Handler Imports
import type { HandlerRegistry } from "../handlers/HandlerRegistry.js";
import type { HandlerContext } from "../handlers/HandlerContext.js";
import { buildModularHandlersFromServer } from "./SmartContextServerHandlers.js";

export class SmartContextServer {
    public server!: Server;
    public rootPath!: string;
    private fileSystem!: NodeFileSystem;
    private incrementalIndexer?: IncrementalIndexer;
    private searchEngine!: SearchEngine;
    private nativeSearchCore?: NativeSearchCore;
    private nativeSearchIndexer?: NativeSearchIndexer;
    private historyEngine!: HistoryEngine;
    private configurationManager!: ConfigurationManager;
    private repoRegistry!: RepoRegistry;
    private boundaryAdapterRegistry!: BoundaryAdapterRegistry;
    private contractRegistry!: ContractRegistry;
    private graphRagConfig!: GraphRagConfigLoader;
    private astManager!: AstManager;
    private skeletonGenerator!: SkeletonGenerator;
    private skeletonCache!: SkeletonCache;
    private symbolIndex!: SymbolIndex;
    private dependencyGraph!: DependencyGraph;
    private callGraphBuilder!: CallGraphBuilder;
    private typeDependencyTracker!: TypeDependencyTracker;
    private dataFlowTracer!: DataFlowTracer;
    private moduleResolver!: ModuleResolver;
    private referenceFinder!: ReferenceFinder;
    private pathNormalizer!: PathNormalizer;
    private hotSpotDetector!: HotSpotDetector;
    private documentProfiler!: DocumentProfiler;
    private documentIndexer?: DocumentIndexer;
    private embeddingRepository!: EmbeddingRepository;
    private embeddingProviderFactory!: EmbeddingProviderFactory;
    private vectorIndexManager!: VectorIndexManager;
    private symbolEmbeddingIndex?: SymbolEmbeddingIndex;
    public documentSearchEngine!: DocumentSearchEngine;
    private ghostInterfaceBuilder!: GhostInterfaceBuilder;
    private fallbackResolver!: FallbackResolver;
    private clusterSearchEngine!: ClusterSearchEngine;
    private impactAnalyzer!: ImpactAnalyzer;
    public indexDatabase!: IndexDatabase;
    private indexStateManager!: IndexStateManager;
    public logStream?: fs.WriteStream;
    public logStreams?: {
        console: fs.WriteStream;
        warn: fs.WriteStream;
        error: fs.WriteStream;
        stdout: fs.WriteStream;
        stderr: fs.WriteStream;
    };
    public diagnosticsInitialized = false;
    private reindexInProgress = false;
    private reindexLastResult?: { success: boolean; output: string; startedAt: string; finishedAt?: string };
    public heartbeatTimer?: NodeJS.Timeout;
    public shutdownRequested = false;
    public shutdownTimer?: NodeJS.Timeout;
    public storagePruneTimer?: NodeJS.Timeout;
    public storagePruneRunning = false;
    private metricsReporter?: AdaptiveFlowReporter;
    private alertDispatcher?: AlertDispatcher;
    private metricsExportService?: MetricsExportService;
    private cacheInvalidationHub?: CacheInvalidationHub;
    private toolSpecRegistry = createDefaultToolSpecRegistry();
    private handlerContext?: HandlerContext;
    private vectorIndexInitPromise?: Promise<void>;
    private betaTelemetry?: BetaTelemetryLogger;

    private handlerRegistry!: HandlerRegistry;


    constructor(rootPath: string) {
        const { state, initialIgnorePatterns } = bootstrapSmartContextServer({
            rootPath,
            serverVersion: SERVER_VERSION,
            isTestEnv: () => this.isTestEnv(),
            getSymbolEmbeddingIndex: () => this.symbolEmbeddingIndex
        });
        Object.assign(this, state);

        this.initFileLogger();
        this.initProcessDiagnostics();
        this.bindRuntimeState(initialIgnorePatterns);

        this.setupHandlers();
        this.registerRuntimeHandlers();

        this.startHeartbeat();
        this.initMetricsReporter();
        this.initMetricsExportService();
        this.startStoragePrune();
        void this.initSymbolSemanticSearch();
    }

    private bindRuntimeState(initialIgnorePatterns: string[]): void {
        this.applyIgnorePatterns(initialIgnorePatterns);
        this.configurationManager.on("ignoreChanged", (payload) => {
            this.applyIgnorePatterns(payload?.patterns ?? []);
        });
    }

    private registerRuntimeHandlers(): void {
        this.initializeModularHandlers();
    }

    private initializeModularHandlers(): void {
        Object.assign(this, buildModularHandlersFromServer(this));
    }

    private async disposeRuntimeForRootSwitch(): Promise<void> {
        this.stopStoragePrune();
        this.metricsReporter?.stop();
        this.metricsReporter = undefined;

        if (this.incrementalIndexer) {
            await this.incrementalIndexer.stop();
        }
        this.clusterSearchEngine.stopBackgroundTasks();
        if (this.vectorIndexInitPromise) {
            await this.vectorIndexInitPromise.catch(() => undefined);
        }
        await this.searchEngine.dispose();
        this.nativeSearchCore?.close();
        await this.symbolIndex.dispose();
        await this.skeletonCache.close();
        await this.astManager.dispose();
        await this.configurationManager.dispose();
        this.graphRagConfig.dispose();
        this.repoRegistry.dispose();
        this.indexDatabase.close();
        this.symbolEmbeddingIndex = undefined;
    }

    public async switchWorkspaceRoot(
        rootPath: string,
        options?: { triggerReindex?: boolean; allowBroadRoot?: boolean }
    ): Promise<{
        success: boolean;
        changed: boolean;
        rootPath: string;
        previousRootPath: string;
        reindexStarted?: boolean;
        output: string;
    }> {
        const requested = String(rootPath ?? "").trim();
        if (requested.length === 0) {
            return {
                success: false,
                changed: false,
                rootPath: this.rootPath,
                previousRootPath: this.rootPath,
                output: "Missing root path."
            };
        }
        const resolved = path.resolve(requested);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            return {
                success: false,
                changed: false,
                rootPath: this.rootPath,
                previousRootPath: this.rootPath,
                output: `Root path does not exist or is not a directory: ${resolved}`
            };
        }
        if (!(options?.allowBroadRoot === true) && isDangerouslyBroadRoot(resolved)) {
            return {
                success: false,
                changed: false,
                rootPath: this.rootPath,
                previousRootPath: this.rootPath,
                output: "Refusing broad root (home or filesystem root). Set allowBroadRoot=true to override."
            };
        }
        const previousRootPath = this.rootPath;
        if (resolved === previousRootPath) {
            return {
                success: true,
                changed: false,
                rootPath: this.rootPath,
                previousRootPath,
                output: "Workspace root unchanged."
            };
        }

        let bootstrap: ReturnType<typeof bootstrapSmartContextServer>;
        try {
            bootstrap = bootstrapSmartContextServer({
                rootPath: resolved,
                serverVersion: SERVER_VERSION,
                isTestEnv: () => this.isTestEnv(),
                getSymbolEmbeddingIndex: () => this.symbolEmbeddingIndex
            });
        } catch (error: any) {
            return {
                success: false,
                changed: false,
                rootPath: this.rootPath,
                previousRootPath,
                output: `Failed to bootstrap runtime for new root: ${error?.message ?? String(error)}`
            };
        }

        await this.disposeRuntimeForRootSwitch();

        const bootstrapServer = bootstrap.state.server as Server;
        const { server: _discardServer, ...nextState } = bootstrap.state;
        Object.assign(this, nextState);
        this.bindRuntimeState(bootstrap.initialIgnorePatterns);
        this.registerRuntimeHandlers();
        this.initMetricsReporter();
        this.startStoragePrune();
        void this.initSymbolSemanticSearch();
        if (this.incrementalIndexer) {
            void this.incrementalIndexer.start().catch((error) => {
                console.error("[SmartContextServer] Incremental indexer failed to start after root switch:", error);
            });
        }
        await bootstrapServer.close();

        let reindexStarted = false;
        if (options?.triggerReindex === true) {
            try {
                await this.dependencyGraph.rebuildIndex();
                reindexStarted = true;
            } catch {
                reindexStarted = false;
            }
        }

        return {
            success: true,
            changed: true,
            rootPath: this.rootPath,
            previousRootPath,
            reindexStarted,
            output: reindexStarted ? "Workspace root switched and reindex started." : "Workspace root switched."
        };
    }

    public isTestEnv(): boolean {
        return process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID != null;
    }

    private setupHandlers(): void {
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
            resources: this.listCatalogResources()
        }));

        this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
            resourceTemplates: this.listCatalogResourceTemplates()
        }));

        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
            contents: await this.readCatalogResource(request.params.uri)
        }));

        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: this.listIntentTools(),
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            return this.handleCallTool(request.params.name, request.params.arguments);
        });
    }

    private initFileLogger(): void {
        initFileLogger(this);
    }

    private initProcessDiagnostics(): void {
        initProcessDiagnostics(this);
    }

    private startHeartbeat(): void {
        startHeartbeat(this);
    }

    private stopHeartbeat(): void {
        stopHeartbeat(this);
    }

    private startStoragePrune(): void {
        startStoragePrune(this);
    }

    private stopStoragePrune(): void {
        stopStoragePrune(this);
    }

    private shouldWarmupSearchIndex(): boolean {
        return shouldWarmupSearchIndex(this);
    }

    private initMetricsReporter(): void {
        this.metricsReporter = initMetricsReporter({
            isTestEnv: () => this.isTestEnv(),
            rootPath: this.rootPath,
            alertDispatcher: this.alertDispatcher,
            parseNumberEnv: (raw, fallback) => this.parseNumberEnv(raw, fallback)
        });
    }

    private initMetricsExportService(): void {
        this.metricsExportService = initMetricsExportService({
            isTestEnv: () => this.isTestEnv()
        });
    }

    private async initSymbolSemanticSearch(): Promise<void> {
        try {
            const symbolEmbeddingIndex = await initSymbolSemanticSearch({
                embeddingProviderFactory: this.embeddingProviderFactory,
                vectorIndexManager: this.vectorIndexManager,
                embeddingRepository: this.embeddingRepository,
                symbolIndex: this.symbolIndex,
                parseNumberEnv: (raw, fallback) => this.parseNumberEnv(raw, fallback)
            });
            if (!symbolEmbeddingIndex) {
                return;
            }
            this.symbolEmbeddingIndex = symbolEmbeddingIndex;
            this.searchEngine.setSymbolEmbeddingIndex(symbolEmbeddingIndex);
            if (this.handlerContext) {
                this.handlerContext.symbolEmbeddingIndex = symbolEmbeddingIndex;
            }
        } catch (error) {
            console.warn("[SmartContextServer] Symbol semantic search init failed:", error);
        }
    }

    public parseNumberEnv(raw: string | undefined, fallback: number): number {
        return parseNumberEnv(raw, fallback);
    }

    private setupShutdownHooks(): void {
        setupShutdownHooks(this);
    }

    public applyIgnorePatterns(patterns: string[]): void {
        applyIgnorePatterns({
            patterns,
            symbolIndex: this.symbolIndex,
            searchEngine: this.searchEngine,
            documentIndexer: this.documentIndexer,
            cacheInvalidationHub: this.cacheInvalidationHub
                ? { onEvent: (event) => this.cacheInvalidationHub?.onEvent(event as any) }
                : undefined
        });
    }

    public listIntentTools(): any[] {
        return listIntentTools(this.toolSpecRegistry);
    }

    public async handleCallTool(name: string, args: any): Promise<any> {
        return dispatchToolCall({
            name,
            payload: args,
            toolSpecRegistry: this.toolSpecRegistry,
            handlerRegistry: this.handlerRegistry,
            errorResponse: (errorCode: string, message: string, details?: any) => ({
                isError: true,
                content: [{ type: 'text', text: JSON.stringify({ errorCode, message, details }) }]
            }),
            ensureResponseHasIsError: (response: any) => {
                if (!response || typeof response !== "object") return;
                if (typeof response.isError === "boolean") return;
                response.isError = response.success === false;
            },
            recordToolCallTelemetry,
            recordResponseTelemetry,
            recordBetaTelemetry: (toolName: string, payloadArgs: any, response: any, startedAt: number) =>
                recordBetaTelemetry({
                    name: toolName,
                    payloadArgs,
                    response,
                    startedAt,
                    betaTelemetry: this.betaTelemetry
                }),
        });
    }

    public validateRequiredArgs(toolName: string, args: any): string[] {
        return validateRequiredArgs(this.toolSpecRegistry, toolName, args);
    }

    public createIgnoreFilter(patterns: string[]): any {
        return createIgnoreFilter(patterns);
    }

    public resolveRelativePath(inputPath: string): string {
        return this.pathNormalizer.normalize(inputPath);
    }

    public resolveAbsolutePath(inputPath: string): string {
        return this.pathNormalizer.toAbsolute(this.resolveRelativePath(inputPath));
    }

    public resolveAlertSeverity(): 'info' | 'warning' | 'error' | 'critical' {
        return resolveAlertSeverity();
    }

    private listCatalogResources(): Array<{
        uri: string;
        name: string;
        title: string;
        description: string;
        mimeType: string;
    }> {
        return [
            {
                uri: "kairo://runtime/summary",
                name: "runtime_summary",
                title: "Runtime Summary",
                description: "Runtime metadata and exposed tool surface.",
                mimeType: "application/json"
            },
            {
                uri: "kairo://config/mcp-policy",
                name: "mcp_policy",
                title: "MCP Policy",
                description: "Resolved MCP mode/preset/public-surface policy.",
                mimeType: "application/json"
            },
            {
                uri: "kairo://index/snapshot",
                name: "index_snapshot",
                title: "Index Snapshot",
                description: "Current index freshness and activity snapshot.",
                mimeType: "application/json"
            },
            {
                uri: "kairo://tools/public",
                name: "public_tools",
                title: "Public Tools",
                description: "Publicly exposed tools and schemas.",
                mimeType: "application/json"
            },
            {
                uri: "kairo://docs/agent-playbook",
                name: "agent_playbook",
                title: "Agent Playbook",
                description: "How to use Kairo tools effectively.",
                mimeType: "text/markdown"
            },
            {
                uri: "kairo://docs/agent-playbook-compact",
                name: "agent_playbook_compact",
                title: "Agent Playbook (Compact)",
                description: "Compact-surface-only usage patterns for task/manage.",
                mimeType: "text/markdown"
            },
            {
                uri: "kairo://docs/tool-reference",
                name: "tool_reference",
                title: "Tool Reference",
                description: "Complete parameter reference for tools.",
                mimeType: "text/markdown"
            },
            {
                uri: "kairo://docs/quick-reference",
                name: "quick_reference",
                title: "Quick Reference",
                description: "Compact Kairo usage cheatsheet.",
                mimeType: "text/markdown"
            }
        ];
    }

    private listCatalogResourceTemplates(): Array<{
        uriTemplate: string;
        name: string;
        title: string;
        description: string;
        mimeType: string;
    }> {
        return [
            {
                uriTemplate: "kairo://schema/{tool}",
                name: "tool_schema",
                title: "Tool Schema",
                description: "Resolved schema metadata for a given tool name.",
                mimeType: "application/json"
            }
        ];
    }

    private async readCatalogResource(uri: string): Promise<Array<{ uri: string; mimeType: string; text: string }>> {
        if (uri === "kairo://runtime/summary") {
            const payload = {
                rootPath: this.rootPath,
                logToFile: process.env.KAIRO_LOG_TO_FILE === "true",
                tools: this.listIntentTools().map((tool) => tool.name).sort(),
                generatedAt: new Date().toISOString()
            };
            return [{ uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }];
        }

        if (uri === "kairo://config/mcp-policy") {
            const payload = { surface: "kairo", tools: this.listIntentTools().map((t) => t.name).sort() };
            return [{ uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }];
        }

        if (uri === "kairo://index/snapshot") {
            const snapshot = await this.indexStateManager.getSnapshot();
            const payload = {
                snapshot,
                activity: this.indexStateManager.getActivity() ?? null,
                generatedAt: new Date().toISOString()
            };
            return [{ uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }];
        }

        if (uri === "kairo://tools/public") {
            const payload = {
                tools: this.listIntentTools(),
                generatedAt: new Date().toISOString()
            };
            return [{ uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }];
        }

        const docResourceMap: Record<string, string> = {
            "kairo://docs/agent-playbook": "docs/agent/AGENT_PLAYBOOK.md",
            "kairo://docs/agent-playbook-compact": "docs/agent/AGENT_PLAYBOOK_COMPACT.md",
            "kairo://docs/tool-reference": "docs/agent/TOOL_REFERENCE.md",
            "kairo://docs/quick-reference": "docs/agent/quick-reference.md"
        };
        const docRelativePath = docResourceMap[uri];
        if (docRelativePath) {
            const candidates = [
                path.resolve(process.cwd(), docRelativePath),
                path.resolve(this.rootPath, docRelativePath)
            ];
            try {
                const packageJsonPath = require.resolve("../../package.json");
                candidates.push(path.resolve(path.dirname(packageJsonPath), docRelativePath));
            } catch {
                // ignore package root lookup errors
            }
            const resolved = candidates.find((candidate) => fs.existsSync(candidate));
            if (!resolved) {
                throw new McpError(ErrorCode.InvalidParams, `Agent document not found for URI: ${uri}`);
            }
            const text = fs.readFileSync(resolved, "utf-8");
            return [{ uri, mimeType: "text/markdown", text }];
        }

        const schemaPrefix = "kairo://schema/";
        if (uri.startsWith(schemaPrefix)) {
            const toolName = decodeURIComponent(uri.slice(schemaPrefix.length)).trim();
            if (!toolName) {
                throw new McpError(ErrorCode.InvalidParams, "Missing tool name in schema resource URI.");
            }
            const spec = this.toolSpecRegistry.get(toolName);
            if (!spec) {
                throw new McpError(ErrorCode.InvalidParams, `Unknown tool schema resource: ${uri}`);
            }
            const payload = {
                tool: spec.name,
                description: spec.description,
                schemaVersion: spec.schemaVersion,
                visibility: spec.visibility,
                inputSchema: spec.inputSchema
            };
            return [{ uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }];
        }

        throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${uri}`);
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
        this.nativeSearchCore?.close();
        await this.symbolIndex.dispose();
        await this.skeletonCache.close();
        await this.astManager.dispose();
        await this.configurationManager.dispose();
        this.graphRagConfig.dispose();
        this.repoRegistry.dispose();
        this.indexDatabase.close();
    }

    public async waitForInitialScan() {
        if (this.incrementalIndexer) {
            await this.incrementalIndexer.waitForInitialScan();
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    public async connect(transport: any): Promise<void> {
        await this.server.connect(transport);

        if (this.incrementalIndexer) {
            void this.incrementalIndexer.start().catch((error) => {
                console.error('[SmartContextServer] Incremental indexer failed to start:', error);
            });
        }

        // Background warmup: warm native search core without blocking.
        if (!this.isTestEnv() && this.shouldWarmupSearchIndex()) {
            setImmediate(() => {
                this.searchEngine.warmup().catch((error) => {
                    console.error('[SmartContextServer] Background warmup failed:', error);
                });
            });
        }
    }

    public async run() {

        this.setupShutdownHooks();
        const transport = new StdioServerTransport();
        await this.connect(transport);
        console.error(`Kairo Server running on stdio (cwd=${process.cwd()})`);
    }
    // Final Verification: Configuration via .kairo/config/.mcp-config.json successful!
}
