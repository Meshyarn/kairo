import { createHandlerContext } from "../handlers/HandlerContext.js";
import { HandlerRegistry } from "../handlers/HandlerRegistry.js";
import { KairoSearchHandler } from "../handlers/kairo/KairoSearchHandler.js";
import { KairoImpactHandler } from "../handlers/kairo/KairoImpactHandler.js";
import { KairoGraphHandler } from "../handlers/kairo/KairoGraphHandler.js";
import { KairoUndoHandler } from "../handlers/kairo/KairoUndoHandler.js";
import { KairoStatusHandler } from "../handlers/kairo/KairoStatusHandler.js";

export function buildModularHandlers(args: Parameters<typeof createHandlerContext>[0] & { isTestEnv: () => boolean }) {
  const handlerRegistry = new HandlerRegistry();
  const handlerContext = createHandlerContext(args);

  const kairoSearchHandler = new KairoSearchHandler(handlerContext);
  const kairoImpactHandler = new KairoImpactHandler(handlerContext);
  const kairoGraphHandler = new KairoGraphHandler(handlerContext);
  const kairoUndoHandler = new KairoUndoHandler(handlerContext);
  const kairoStatusHandler = new KairoStatusHandler(handlerContext);

  handlerRegistry.register(kairoSearchHandler);
  handlerRegistry.register(kairoImpactHandler);
  handlerRegistry.register(kairoGraphHandler);
  handlerRegistry.register(kairoUndoHandler);
  handlerRegistry.register(kairoStatusHandler);

  return {
    handlerRegistry,
    handlerContext,
  };
}

export function buildModularHandlersFromServer(server: any) {
  return buildModularHandlers({
    rootPath: server.rootPath,
    repoRegistry: server.repoRegistry,
    fileSystem: server.fileSystem,
    orchestrationEngine: server.orchestrationEngine,
    internalRegistry: server.internalRegistry,
    searchEngine: server.searchEngine,
    documentSearchEngine: server.documentSearchEngine,
    symbolIndex: server.symbolIndex,
    symbolEmbeddingIndex: server.symbolEmbeddingIndex,
    astManager: server.astManager,
    contextEngine: server.contextEngine,
    dependencyGraph: server.dependencyGraph,
    callGraphBuilder: server.callGraphBuilder,
    impactAnalyzer: server.impactAnalyzer,
    typeDependencyTracker: server.typeDependencyTracker,
    dataFlowTracer: server.dataFlowTracer,
    skeletonGenerator: server.skeletonGenerator,
    skeletonCache: server.skeletonCache,
    referenceFinder: server.referenceFinder,
    documentProfiler: server.documentProfiler,
    fallbackResolver: server.fallbackResolver,
    pathNormalizer: server.pathNormalizer,
    editCoordinator: server.editCoordinator,
    fileVersionManager: server.fileVersionManager,
    indexStateManager: server.indexStateManager,
    incrementalIndexer: server.incrementalIndexer,
    documentIndexer: server.documentIndexer,
    indexDatabase: server.indexDatabase,
    historyEngine: server.historyEngine,
    flowArtifactManager: server.flowArtifactManager,
    metricsExportService: server.metricsExportService,
    cacheInvalidationHub: server.cacheInvalidationHub,
    toolSpecRegistry: server.toolSpecRegistry,
    callGraphMetricsBuilder: server.callGraphMetricsBuilder,
    graphRagClusterService: server.graphRagClusterService,
    hotSpotDetector: server.hotSpotDetector,
    isTestEnv: () => server.isTestEnv(),
    runtimeControl: {
      switchWorkspaceRoot: (rootPath: string, options?: { triggerReindex?: boolean; allowBroadRoot?: boolean }) =>
        server.switchWorkspaceRoot(rootPath, options)
    }
  });
}
