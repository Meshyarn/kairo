import type { OrchestrationEngine } from "../orchestration/OrchestrationEngine.js";
import type { InternalToolRegistry } from "../orchestration/InternalToolRegistry.js";
import type { SearchEngine } from "../engine/Search.js";
import type { DocumentSearchEngine } from "../documents/search/DocumentSearchEngine.js";
import type { SymbolIndex } from "../ast/SymbolIndex.js";
import type { AstManager } from "../ast/AstManager.js";
import type { ContextEngine } from "../engine/Context.js";
import type { DependencyGraph } from "../ast/DependencyGraph.js";
import type { CallGraphBuilder } from "../ast/CallGraphBuilder.js";
import type { ImpactAnalyzer } from "../engine/ImpactAnalyzer.js";
import type { TypeDependencyTracker } from "../ast/TypeDependencyTracker.js";
import type { DataFlowTracer } from "../ast/DataFlowTracer.js";
import type { SkeletonGenerator } from "../ast/SkeletonGenerator.js";
import type { SkeletonCache } from "../ast/SkeletonCache.js";
import type { ReferenceFinder } from "../ast/ReferenceFinder.js";
import type { DocumentProfiler } from "../documents/DocumentProfiler.js";
import type { FallbackResolver } from "../resolution/FallbackResolver.js";
import type { PathNormalizer } from "../utils/PathNormalizer.js";
import type { EditCoordinator } from "../engine/EditCoordinator.js";
import type { FileVersionManager } from "../engine/FileVersionManager.js";
import type { DocumentIndexer } from "../indexing/DocumentIndexer.js";
import type { IndexDatabase } from "../indexing/IndexDatabase.js";
import type { IndexStateManager } from "../indexing/IndexStateManager.js";
import type { IncrementalIndexer } from "../indexing/IncrementalIndexer.js";
import type { HistoryEngine } from "../engine/History.js";
import type { NodeFileSystem } from "../platform/FileSystem.js";
import type { RepoRegistry } from "../config/RepoRegistry.js";
import type { FlowArtifactManager } from "../orchestration/flow-artifact-manager.js";
import type { MetricsExportService } from "../utils/metrics/MetricsExportService.js";

export interface HandlerContext {
    rootPath: string;
    repoRegistry: RepoRegistry;
    fileSystem: NodeFileSystem;
    orchestrationEngine: OrchestrationEngine;
    internalRegistry: InternalToolRegistry;
    searchEngine: SearchEngine;
    documentSearchEngine: DocumentSearchEngine;
    symbolIndex: SymbolIndex;
    astManager: AstManager;
    contextEngine: ContextEngine;
    dependencyGraph: DependencyGraph;
    callGraphBuilder: CallGraphBuilder;
    impactAnalyzer: ImpactAnalyzer;
    typeDependencyTracker: TypeDependencyTracker;
    dataFlowTracer: DataFlowTracer;
    skeletonGenerator: SkeletonGenerator;
    skeletonCache: SkeletonCache;
    referenceFinder: ReferenceFinder;
    documentProfiler: DocumentProfiler;
    fallbackResolver: FallbackResolver;
    pathNormalizer: PathNormalizer;
    editCoordinator: EditCoordinator;
    fileVersionManager: FileVersionManager;
    indexStateManager: IndexStateManager;
    incrementalIndexer?: IncrementalIndexer;
    documentIndexer?: DocumentIndexer;
    indexDatabase: IndexDatabase;
    historyEngine: HistoryEngine;
    flowArtifactManager: FlowArtifactManager;
    metricsExportService?: MetricsExportService;
    isTestEnv: () => boolean;
    metadata?: Record<string, unknown>;
}

export function createHandlerContext(deps: HandlerContext): HandlerContext {
    return deps;
}
