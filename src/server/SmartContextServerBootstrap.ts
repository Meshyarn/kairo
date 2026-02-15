import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import * as path from "path";
import { RolloutController } from "../config/RolloutController.js";
import { ModularRolloutController } from "../config/ModularRolloutController.js";
import { PathManager } from "../utils/PathManager.js";
import { BetaTelemetryLogger } from "../utils/BetaTelemetryLogger.js";
import { NodeFileSystem } from "../platform/FileSystem.js";
import { AlertDispatcher } from "../utils/AlertDispatcher.js";
import { AstManager } from "../ast/AstManager.js";
import { PathNormalizer } from "../utils/PathNormalizer.js";
import { ConfigurationManager } from "../config/ConfigurationManager.js";
import { GraphRagConfigLoader } from "../config/GraphRagConfig.js";
import { RepoRegistry } from "../config/RepoRegistry.js";
import { BoundaryAdapterRegistry } from "../contracts/BoundaryAdapterRegistry.js";
import { ContractRegistry } from "../contracts/ContractRegistry.js";
import { PackageAliasMap } from "../config/PackageAliasMap.js";
import { createIgnoreFilter } from "./SmartContextServerTooling.js";
import { ContextEngine } from "../engine/Context.js";
import { SkeletonGenerator } from "../ast/SkeletonGenerator.js";
import { SkeletonCache } from "../ast/SkeletonCache.js";
import { IndexDatabase } from "../indexing/IndexDatabase.js";
import { NativeSearchCore } from "../engine/search/native/NativeSearchCore.js";
import { NativeSearchIndexer } from "../engine/search/native/NativeSearchIndexer.js";
import { EmbeddingRepository } from "../indexing/EmbeddingRepository.js";
import { EmbeddingProviderFactory } from "../embeddings/EmbeddingProviderFactory.js";
import { resolveEmbeddingConfigFromEnv } from "../embeddings/EmbeddingConfig.js";
import { VectorIndexManager } from "../vector/VectorIndexManager.js";
import { DocumentProfiler } from "../documents/DocumentProfiler.js";
import { DocumentIndexer } from "../indexing/DocumentIndexer.js";
import { SymbolIndex } from "../ast/SymbolIndex.js";
import { ModuleResolver } from "../ast/ModuleResolver.js";
import { DependencyGraph } from "../ast/DependencyGraph.js";
import { CallGraphBuilder } from "../ast/CallGraphBuilder.js";
import { TypeDependencyTracker } from "../ast/TypeDependencyTracker.js";
import { DataFlowTracer } from "../ast/DataFlowTracer.js";
import { PropertyAccessIndex } from "../ast/PropertyAccessIndex.js";
import { FieldAccessIndex } from "../ast/FieldAccessIndex.js";
import { ImpactAnalyzer } from "../engine/ImpactAnalyzer.js";
import { HotSpotDetector } from "../engine/ClusterSearch/HotSpotDetector.js";
import { ReferenceFinder } from "../ast/ReferenceFinder.js";
import { IndexStateManager } from "../indexing/IndexStateManager.js";
import { IncrementalIndexer } from "../indexing/IncrementalIndexer.js";
import { SearchEngine } from "../engine/Search.js";
import { DocumentSearchEngine } from "../documents/search/DocumentSearchEngine.js";
import { DocumentChunkRepository } from "../indexing/DocumentChunkRepository.js";
import { EvidencePackRepository } from "../indexing/EvidencePackRepository.js";
import { ClusterSearchEngine } from "../engine/ClusterSearch/index.js";
import { CachingStrategy } from "../orchestration/CachingStrategy.js";
import { CacheInvalidationHub } from "./CacheInvalidationHub.js";
import { HistoryEngine } from "../engine/History.js";
import { EditorEngine } from "../engine/Editor.js";
import { AstAwareDiff } from "../engine/AstAwareDiff.js";
import { TransactionLog } from "../engine/TransactionLog.js";
import { PatchStore } from "../engine/PatchStore.js";
import { EditCoordinator } from "../engine/EditCoordinator.js";
import { FileVersionManager } from "../engine/FileVersionManager.js";
import { GhostInterfaceBuilder } from "../resolution/GhostInterfaceBuilder.js";
import { CallSiteAnalyzer } from "../ast/analysis/CallSiteAnalyzer.js";
import { FallbackResolver } from "../resolution/FallbackResolver.js";
import { InternalToolRegistry } from "../orchestration/InternalToolRegistry.js";
import { FlowArtifactManager } from "../orchestration/flow-artifact-manager.js";
import { OrchestrationEngine } from "../orchestration/OrchestrationEngine.js";
import { IntentRouter } from "../orchestration/IntentRouter.js";
import { WorkflowPlanner } from "../orchestration/WorkflowPlanner.js";
import { resolveAlertSeverity, resolveBaselineEnabled } from "./SmartContextServerEnv.js";
import type { SymbolEmbeddingIndex } from "../indexing/SymbolEmbeddingIndex.js";

export type SmartContextServerBootstrap = {
  state: Record<string, any>;
  initialIgnorePatterns: string[];
  packageAliasMap: PackageAliasMap;
  propertyAccessIndex: PropertyAccessIndex;
};

export function bootstrapSmartContextServer(args: {
  rootPath: string;
  serverVersion: string;
  isTestEnv: () => boolean;
  getSymbolEmbeddingIndex?: () => SymbolEmbeddingIndex | undefined;
}): SmartContextServerBootstrap {
  const { rootPath, serverVersion, isTestEnv, getSymbolEmbeddingIndex } = args;
  const server = new Server({
    name: "kairo",
    version: serverVersion
  }, {
    capabilities: { tools: {}, resources: {} }
  });

  const resolvedRootPath = path.resolve(rootPath);
  RolloutController.applyFromEnv();
  ModularRolloutController.applyFromEnv();
  PathManager.setRoot(resolvedRootPath);

  const betaTelemetry = BetaTelemetryLogger.fromEnv(resolvedRootPath);
  const fileSystem = new NodeFileSystem(resolvedRootPath);
  const alertDispatcher = new AlertDispatcher({
    rootPath: resolvedRootPath,
    logDir: process.env.KAIRO_ALERT_LOG_DIR
      ?? process.env.KAIRO_LOG_DIR
      ?? PathManager.resolve("logs"),
    webhookUrl: process.env.KAIRO_ALERT_WEBHOOK,
    command: process.env.KAIRO_ALERT_COMMAND,
    pagerDutyRoutingKey: process.env.KAIRO_PAGERDUTY_ROUTING_KEY,
    severity: resolveAlertSeverity(),
    channel: process.env.KAIRO_ALERT_CHANNEL ?? undefined,
    label: process.env.KAIRO_ALERT_LABEL ?? undefined
  });

  const astManager = AstManager.getInstance();
  const pathNormalizer = new PathNormalizer(resolvedRootPath);
  const configurationManager = new ConfigurationManager(resolvedRootPath);
  const graphRagConfig = new GraphRagConfigLoader(resolvedRootPath);
  const repoRegistry = new RepoRegistry(resolvedRootPath);
  const boundaryAdapterRegistry = BoundaryAdapterRegistry.createDefault(resolvedRootPath, repoRegistry);
  const contractRegistry = new ContractRegistry(resolvedRootPath, repoRegistry);
  for (const adapter of boundaryAdapterRegistry.getAll()) {
    contractRegistry.registerAdapter(adapter);
  }

  const packageAliasMap = new PackageAliasMap(repoRegistry);
  packageAliasMap.build();
  const initialIgnorePatterns = configurationManager.getIgnoreGlobs();
  const ignoreFilter = createIgnoreFilter(initialIgnorePatterns);
  const contextEngine = new ContextEngine(ignoreFilter, fileSystem);

  const skeletonGenerator = new SkeletonGenerator();
  const skeletonCache = new SkeletonCache(resolvedRootPath);
  const indexDatabase = new IndexDatabase(resolvedRootPath);
  const defaultRepoId = repoRegistry.getDefaultRepo()?.id ?? "default";
  let nativeSearchCore: NativeSearchCore | undefined;
  let nativeSearchIndexer: NativeSearchIndexer | undefined;
  try {
    nativeSearchCore = new NativeSearchCore(resolvedRootPath, { repoId: defaultRepoId });
    nativeSearchIndexer = new NativeSearchIndexer(nativeSearchCore);
  } catch (error: any) {
    const message = error?.message ? String(error.message) : String(error);
    throw new Error(
      `[SmartContextServer] Native search init failed: ${message}. ` +
      `Build the native module with \`npm run build:core-rs\` (requires Rust).`
    );
  }

  const embeddingRepository = new EmbeddingRepository(indexDatabase);
  const embeddingProviderFactory = new EmbeddingProviderFactory(resolveEmbeddingConfigFromEnv());
  const vectorIndexManager = new VectorIndexManager(resolvedRootPath, embeddingRepository);
  const vectorIndexInitPromise = vectorIndexManager
    .initializeFromEmbeddingConfig(embeddingProviderFactory.getConfig())
    .catch((error) => {
      if (!isTestEnv()) {
        console.warn("[SmartContextServer] Vector index initialization failed:", error);
      }
    });

  const documentProfiler = new DocumentProfiler(resolvedRootPath);
  const documentIndexer = new DocumentIndexer(resolvedRootPath, fileSystem, indexDatabase, {
    embeddingRepository,
    embeddingProviderFactory,
    vectorIndexManager,
    nativeSearchIndexer,
    repoId: defaultRepoId
  });

  const symbolIndex = new SymbolIndex(
    resolvedRootPath,
    skeletonGenerator,
    initialIgnorePatterns,
    indexDatabase,
    undefined,
    { nativeSearchIndexer, repoId: defaultRepoId }
  );
  const moduleResolver = new ModuleResolver({ rootPath: resolvedRootPath, packageAliasMap });
  const dependencyGraph = new DependencyGraph(resolvedRootPath, symbolIndex, moduleResolver, indexDatabase);
  const callGraphBuilder = new CallGraphBuilder(resolvedRootPath, symbolIndex, moduleResolver);
  const typeDependencyTracker = new TypeDependencyTracker(resolvedRootPath, symbolIndex);
  const dataFlowTracer = new DataFlowTracer(resolvedRootPath, symbolIndex, fileSystem);
  const propertyAccessIndex = new PropertyAccessIndex(resolvedRootPath);
  const fieldAccessIndex = new FieldAccessIndex(resolvedRootPath, { propertyAccessIndex });
  const impactAnalyzer = new ImpactAnalyzer(dependencyGraph, callGraphBuilder, symbolIndex, undefined, fieldAccessIndex);
  const hotSpotDetector = new HotSpotDetector(symbolIndex, dependencyGraph);
  const referenceFinder = new ReferenceFinder(
    resolvedRootPath,
    dependencyGraph,
    symbolIndex,
    skeletonGenerator,
    moduleResolver
  );

  const indexStateManager = new IndexStateManager(async () => {
    const status = await dependencyGraph.getIndexStatus({ includePerFile: false });
    const totalFiles = status?.global?.totalFiles ?? 0;
    const indexedFiles = status?.global?.indexedFiles ?? totalFiles;
    const lastRebuilt = status?.global?.lastRebuiltAt
      ? Date.parse(status.global.lastRebuiltAt)
      : undefined;
    return { totalFiles, indexedFiles, lastIndexedAt: Number.isFinite(lastRebuilt) ? lastRebuilt : undefined };
  });

  let cacheInvalidationHub: CacheInvalidationHub | undefined;
  const toRelative = (filePath: string) => path.relative(resolvedRootPath, filePath).replace(/\\/g, "/");
  const incrementalIndexer = new IncrementalIndexer(
    resolvedRootPath,
    symbolIndex,
    dependencyGraph,
    indexDatabase,
    moduleResolver,
    configurationManager,
    {
      watch: true,
      initialScan: resolveBaselineEnabled(isTestEnv),
      onFileQueued: (filePath) => {
        indexStateManager.markDirty(toRelative(filePath));
        cacheInvalidationHub?.onEvent({ type: "file_changed", absPath: filePath });
      },
      onFileIndexed: (filePath) => {
        indexStateManager.clearDirty(toRelative(filePath));
        const symbolEmbeddingIndex = getSymbolEmbeddingIndex?.();
        if (symbolEmbeddingIndex?.isReadyForIncremental()) {
          void (async () => {
            try {
              const stat = await fileSystem.stat(filePath).catch(() => undefined);
              await symbolEmbeddingIndex.indexSymbolsForFile(filePath, { mtime: stat?.mtime });
            } catch (error) {
              console.warn("[SmartContextServer] Symbol incremental index failed:", error);
            }
          })();
        }
      },
      onFileRemoved: (filePath) => {
        indexStateManager.clearDirty(toRelative(filePath));
        cacheInvalidationHub?.onEvent({ type: "file_deleted", absPath: filePath });
        const symbolEmbeddingIndex = getSymbolEmbeddingIndex?.();
        if (symbolEmbeddingIndex?.isReadyForIncremental()) {
          void symbolEmbeddingIndex.clearSymbolsForFile(filePath).catch((error) => {
            console.warn("[SmartContextServer] Symbol incremental clear failed:", error);
          });
        }
      },
      onDirectoryRemoved: (dirPath) => {
        cacheInvalidationHub?.onEvent({ type: "dir_deleted", absPath: dirPath });
      },
      onActivity: (activity) => {
        indexStateManager.setActivity(activity);
      },
      nativeSearchIndexer,
      repoId: defaultRepoId
    },
    documentIndexer
  );

  const searchEngine = new SearchEngine(resolvedRootPath, fileSystem, [], {
    nativeSearchCore,
    repoId: defaultRepoId
  });
  const documentSearchEngine = new DocumentSearchEngine(
    documentIndexer,
    new DocumentChunkRepository(indexDatabase),
    embeddingRepository,
    embeddingProviderFactory,
    resolvedRootPath,
    symbolIndex,
    new EvidencePackRepository(indexDatabase),
    vectorIndexManager,
    indexDatabase,
    nativeSearchCore,
    defaultRepoId
  );
  const clusterSearchEngine = new ClusterSearchEngine({
    rootPath: resolvedRootPath,
    symbolIndex,
    callGraphBuilder,
    typeDependencyTracker,
    dependencyGraph,
    fileSystem
  });
  if (!isTestEnv()) {
    graphRagConfig.watch(() => {
      clusterSearchEngine.clearCache();
    });
  }

  const cacheStrategy = new CachingStrategy(resolvedRootPath);
  cacheInvalidationHub = new CacheInvalidationHub({
    rootPath: resolvedRootPath,
    indexStateManager,
    searchEngine,
    dependencyGraph,
    clusterSearchEngine,
    documentSearchEngine,
    documentIndexer,
    orchestrationCache: cacheStrategy,
    callGraphBuilder,
    typeDependencyTracker
  });
  void cacheInvalidationHub.syncEpoch();

  const historyEngine = new HistoryEngine(resolvedRootPath, fileSystem);
  const editorEngine = new EditorEngine(resolvedRootPath, fileSystem, new AstAwareDiff(skeletonGenerator));
  const transactionLog = new TransactionLog(indexDatabase, new PatchStore());

  const editCoordinator = new EditCoordinator(editorEngine, historyEngine, {
    rootPath: resolvedRootPath,
    transactionLog,
    fileSystem,
    impactAnalyzer
  });

  const fileVersionManager = new FileVersionManager(fileSystem);
  const ghostInterfaceBuilder = new GhostInterfaceBuilder(
    searchEngine,
    new CallSiteAnalyzer(),
    astManager,
    fileSystem,
    resolvedRootPath
  );
  const fallbackResolver = new FallbackResolver(symbolIndex, skeletonGenerator, ghostInterfaceBuilder);

  const internalRegistry = new InternalToolRegistry();
  const flowArtifactManager = new FlowArtifactManager({
    persistPath: PathManager.resolve("flow-artifacts"),
    fileSystem,
    autoPersist: true
  });
  const orchestrationEngine = new OrchestrationEngine(
    new IntentRouter(),
    new WorkflowPlanner(),
    internalRegistry,
    cacheStrategy
  );

  return {
    state: {
      server,
      rootPath: resolvedRootPath,
      fileSystem,
      cacheInvalidationHub,
      flowArtifactManager,
      orchestrationEngine,
      internalRegistry,
      incrementalIndexer,
      searchEngine,
      nativeSearchCore,
      nativeSearchIndexer,
      editCoordinator,
      historyEngine,
      configurationManager,
      repoRegistry,
      boundaryAdapterRegistry,
      contractRegistry,
      graphRagConfig,
      astManager,
      skeletonGenerator,
      skeletonCache,
      symbolIndex,
      dependencyGraph,
      callGraphBuilder,
      typeDependencyTracker,
      dataFlowTracer,
      moduleResolver,
      referenceFinder,
      contextEngine,
      fileVersionManager,
      pathNormalizer,
      hotSpotDetector,
      documentProfiler,
      documentIndexer,
      embeddingRepository,
      embeddingProviderFactory,
      vectorIndexManager,
      documentSearchEngine,
      ghostInterfaceBuilder,
      fallbackResolver,
      clusterSearchEngine,
      impactAnalyzer,
      indexDatabase,
      indexStateManager,
      cacheStrategy,
      alertDispatcher,
      betaTelemetry,
      vectorIndexInitPromise
    },
    initialIgnorePatterns,
    packageAliasMap,
    propertyAccessIndex
  };
}
