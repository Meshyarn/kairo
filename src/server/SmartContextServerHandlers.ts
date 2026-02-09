import { createHandlerContext } from "../handlers/HandlerContext.js";
import { HandlerRegistry } from "../handlers/HandlerRegistry.js";
import { SearchHandlers } from "../handlers/SearchHandlers.js";
import { CodeHandlers } from "../handlers/CodeHandlers.js";
import { EditHandlers } from "../handlers/EditHandlers.js";
import { DocumentHandlers } from "../handlers/DocumentHandlers.js";
import { ManageHandlers } from "../handlers/ManageHandlers.js";
import { NavigateHandlers } from "../handlers/NavigateHandlers.js";
import { IntegrityHandlers } from "../handlers/IntegrityHandlers.js";
import { TaskHandlers } from "../handlers/TaskHandlers.js";

export function buildModularHandlers(args: Parameters<typeof createHandlerContext>[0] & { isTestEnv: () => boolean }) {
  const handlerRegistry = new HandlerRegistry();
  const handlerContext = createHandlerContext(args);
  const searchHandlers = new SearchHandlers(handlerContext);
  const codeHandlers = new CodeHandlers(handlerContext);
  const editHandlers = new EditHandlers(handlerContext);
  const documentHandlers = new DocumentHandlers(handlerContext);
  const manageHandlers = new ManageHandlers(handlerContext);
  const navigateHandlers = new NavigateHandlers(handlerContext);
  const integrityHandlers = new IntegrityHandlers(handlerContext);
  const taskHandlers = new TaskHandlers(handlerContext);

  handlerRegistry.register(searchHandlers);
  handlerRegistry.register(codeHandlers);
  handlerRegistry.register(editHandlers);
  handlerRegistry.register(documentHandlers);
  handlerRegistry.register(manageHandlers);
  handlerRegistry.register(navigateHandlers);
  handlerRegistry.register(integrityHandlers);
  handlerRegistry.register(taskHandlers);

  return {
    handlerRegistry,
    handlerContext,
    searchHandlers,
    codeHandlers,
    editHandlers,
    documentHandlers,
    manageHandlers,
    navigateHandlers,
    integrityHandlers,
    taskHandlers
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
    isTestEnv: () => server.isTestEnv(),
    runtimeControl: {
      switchWorkspaceRoot: (rootPath: string, options?: { triggerReindex?: boolean; allowBroadRoot?: boolean }) =>
        server.switchWorkspaceRoot(rootPath, options)
    }
  });
}
