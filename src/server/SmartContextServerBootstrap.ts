import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import * as path from "path";
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
import { SkeletonGenerator } from "../ast/SkeletonGenerator.js";
import { SkeletonCache } from "../ast/SkeletonCache.js";
import { IndexDatabase } from "../indexing/IndexDatabase.js";
import { NativeSearchCore, NativeSearchError, type NativeSearchCoreClient } from "../engine/search/native/NativeSearchCore.js";
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
import { CacheInvalidationHub } from "./CacheInvalidationHub.js";
import { HistoryEngine } from "../engine/History.js";
import { GhostInterfaceBuilder } from "../resolution/GhostInterfaceBuilder.js";
import { CallSiteAnalyzer } from "../ast/analysis/CallSiteAnalyzer.js";
import { FallbackResolver } from "../resolution/FallbackResolver.js";
import { CallGraphMetricsBuilder } from "../engine/CallGraphMetricsBuilder.js";
import { GraphRagClusterService } from "../orchestration/cluster/GraphRagClusterService.js";
import { resolveAlertSeverity, resolveBaselineEnabled } from "./SmartContextServerEnv.js";
import type { SymbolEmbeddingIndex } from "../indexing/SymbolEmbeddingIndex.js";

export type SmartContextServerBootstrap = {
  state: Record<string, any>;
  initialIgnorePatterns: string[];
};

function createLazyInstance<T extends object>(factory: () => T): T {
  let instance: T | undefined;
  const ensure = (): T => {
    if (!instance) {
      instance = factory();
    }
    return instance;
  };
  return new Proxy({} as T, {
    get(_target, property) {
      const target = ensure() as Record<PropertyKey, unknown>;
      const value = target[property];
      if (typeof value === "function") {
        return (value as Function).bind(target);
      }
      return value;
    },
    set(_target, property, value) {
      const target = ensure() as Record<PropertyKey, unknown>;
      target[property] = value;
      return true;
    },
    has(_target, property) {
      return property in (ensure() as Record<PropertyKey, unknown>);
    },
    ownKeys() {
      return Reflect.ownKeys(ensure() as object);
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Object.getOwnPropertyDescriptor(ensure() as object, property);
      if (descriptor) return descriptor;
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: undefined
      };
    }
  });
}

function createUnavailableNativeSearchCore(message: string): NativeSearchCoreClient {
  const unavailable = () => {
    throw new NativeSearchError("CAP_NATIVE_SEARCH_UNAVAILABLE", message);
  };
  return {
    upsert: () => undefined,
    upsertMany: () => undefined,
    deleteDoc: () => undefined,
    commit: () => undefined,
    search: () => unavailable(),
    close: () => undefined,
    stats: () => unavailable(),
    reset: () => unavailable()
  };
}

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
    const fallbackMessage = `[SmartContextServer] Native search unavailable; using JS scan fallback. ${message}`;
    if (!isTestEnv()) {
      console.warn(`${fallbackMessage} Build the native module with \`npm run build:core-rs\` (requires Rust).`);
    }
    const unavailableCore = createUnavailableNativeSearchCore(fallbackMessage);
    nativeSearchCore = unavailableCore as unknown as NativeSearchCore;
    nativeSearchIndexer = new NativeSearchIndexer(unavailableCore);
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
  const callGraphBuilder = createLazyInstance(
    () => new CallGraphBuilder(resolvedRootPath, symbolIndex, moduleResolver)
  );
  const typeDependencyTracker = createLazyInstance(
    () => new TypeDependencyTracker(resolvedRootPath, symbolIndex)
  );
  const dataFlowTracer = createLazyInstance(
    () => new DataFlowTracer(resolvedRootPath, symbolIndex, fileSystem)
  );
  const propertyAccessIndex = new PropertyAccessIndex(resolvedRootPath);
  const fieldAccessIndex = new FieldAccessIndex(resolvedRootPath, { propertyAccessIndex });
  const impactAnalyzer = new ImpactAnalyzer(dependencyGraph, callGraphBuilder, symbolIndex, undefined, fieldAccessIndex);
  const hotSpotDetector = new HotSpotDetector(symbolIndex, dependencyGraph);
  const callGraphMetricsBuilder = new CallGraphMetricsBuilder(callGraphBuilder);
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

  cacheInvalidationHub = new CacheInvalidationHub({
    rootPath: resolvedRootPath,
    indexStateManager,
    searchEngine,
    dependencyGraph,
    clusterSearchEngine,
    documentSearchEngine,
    documentIndexer,
    callGraphBuilder,
    typeDependencyTracker
  });
  void cacheInvalidationHub.syncEpoch();

  const historyEngine = new HistoryEngine(resolvedRootPath, fileSystem);
  const ghostInterfaceBuilder = new GhostInterfaceBuilder(
    searchEngine,
    new CallSiteAnalyzer(),
    astManager,
    fileSystem,
    resolvedRootPath
  );
  const fallbackResolver = new FallbackResolver(symbolIndex, skeletonGenerator, ghostInterfaceBuilder);

  const graphRagClusterService = new GraphRagClusterService({
    clusterSearchEngine,
    symbolIndex,
    pathNormalizer,
    repoRegistry,
    graphRagConfig,
    documentSearchEngine,
    documentProfiler,
    boundaryAdapterRegistry,
    rootPath: resolvedRootPath,
  });

  return {
    state: {
      server,
      rootPath: resolvedRootPath,
      fileSystem,
      cacheInvalidationHub,
      incrementalIndexer,
      searchEngine,
      nativeSearchCore,
      nativeSearchIndexer,
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
      pathNormalizer,
      hotSpotDetector,
      callGraphMetricsBuilder,
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
      graphRagClusterService,
      indexDatabase,
      indexStateManager,
      alertDispatcher,
      betaTelemetry,
      vectorIndexInitPromise
    },
    initialIgnorePatterns
  };
}
