import path from "path";
import { BudgetManager } from "../../BudgetManager.js";
import { UnifiedContextGraph } from "../../context/UnifiedContextGraph.js";
import { OrchestrationContext } from "../../OrchestrationContext.js";
import type { ProgressState } from "../../../utils/ProgressLogger.js";
import { checkSkeletonSupport } from "../../../ast/LanguageSupportSignals.js";
import { UniversalFallbackExtractor } from "../../../ast/extraction/UniversalFallbackExtractor.js";
import { AstManager } from "../../../ast/AstManager.js";
import { applyTokenBudget } from "../../TokenBudget.js";
import {
  categorizeDocLinks,
  collectDependenciesFromGraph,
  mergeRelatedCode,
  resolveCodeReferences,
  resolveMentionReferences
} from "./DependencyAnalysis.js";
import { fetchCallGraph } from "./CallGraphAnalysis.js";
import {
  applySkeletonCompressionDecision,
  resolveAllowGraphs,
  shouldBuildFallbackGraph
} from "./UnderstandDecisionEngine.js";
import { buildGraphPack, buildSkeletonDigest } from "./UnderstandPillarArtifacts.js";
import type { UnderstandExecutionSetup } from "./UnderstandPillarExecutionSetup.js";
import { createUnderstandExecutionState, type UnderstandExecutionState } from "./UnderstandPillarExecutionState.js";
import type { GraphPack } from "../../../types/flow-artifacts.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";

export interface UnderstandCollectedData {
  filePath: string;
  symbolName?: string;
  isDocument: boolean;
  skeleton: any;
  docProfile?: any;
  docReferences?: any;
  relatedCode?: any[];
  mentionMatches?: any[];
  calls?: any;
  callGraphArtifactId?: string;
  callGraphSummary?: GraphPack["summary"];
  callGraphPreview?: { nodes: any[]; edges: any[]; resolvedTarget?: any; meta?: any };
  deps?: any;
  hotSpots?: any;
  fallbackGraph?: { mode: "l2"; edges: Array<{ from: string; to: string; confidence: "low"; reason?: string }>; evidence?: string[] };
  refinementReason?: string;
  allowGraphs: boolean;
  compressionDecision: ReturnType<typeof applySkeletonCompressionDecision>;
  budget: ReturnType<typeof BudgetManager.create>;
  projectStats?: any;
  searchResult: { results: any[] };
}

export async function collectUnderstandData(args: {
  setup: UnderstandExecutionSetup;
  context: OrchestrationContext;
  runTool: (context: OrchestrationContext, tool: string, args: any, progress?: ProgressState) => Promise<any>;
  progress?: ProgressState;
  searchResult: { results: any[] };
  filePath: string;
  symbolName?: string;
  isDocument: boolean;
  artifactManager?: FlowArtifactManager;
}): Promise<{ data: UnderstandCollectedData; state: UnderstandExecutionState }> {
  const { setup, context, runTool, progress, searchResult, filePath, symbolName, isDocument, artifactManager } = args;
  const state = createUnderstandExecutionState({ budgetOmissions: setup.budgetOmissions, traceBuilder: setup.traceBuilder });

  const ucg = context.getState<UnifiedContextGraph>("ucg");
  const runToolWithContext = (ctx: OrchestrationContext, tool: string, params: any, progressArg?: ProgressState) =>
    runTool(ctx, tool, params, progressArg);

  let skeleton: any = "";
  let docProfile: any = undefined;
  let docReferences: any = undefined;
  let relatedCode: any[] | undefined = undefined;
  let mentionMatches: any[] | undefined = undefined;
  if (isDocument) {
    const docAnalysis = await runToolWithContext(context, "document_analyze", { filePath }, progress);
    skeleton = docAnalysis?.skeleton ?? "";
    docProfile = docAnalysis?.profile;
    if (docProfile?.links?.length) {
      docReferences = categorizeDocLinks(docProfile.links);
      relatedCode = await resolveCodeReferences(context, docReferences.code ?? [], runToolWithContext, progress);
    }
    if (Array.isArray(docProfile?.mentions) && docProfile.mentions.length > 0) {
      mentionMatches = await resolveMentionReferences(context, docProfile.mentions, runToolWithContext, progress);
      relatedCode = mergeRelatedCode(relatedCode, mentionMatches);
    }
    if (setup.relatedCodeLimit && Array.isArray(relatedCode) && relatedCode.length > setup.relatedCodeLimit) {
      relatedCode = relatedCode.slice(0, setup.relatedCodeLimit);
      state.degraded = true;
      if (!state.degradedReasons.includes("budget_exceeded")) {
        state.degradedReasons.push("budget_exceeded");
      }
      state.refinementReason = state.refinementReason ?? "budget_exceeded";
      if (setup.traceBuilder) {
        setup.traceBuilder.recordEvent({
          area: "budget",
          code: "allocator.section_omit",
          data: { section: "related_code" }
        });
      }
    }
  } else {
    const support = await checkSkeletonSupport(filePath);
    if (support.degraded && support.reason) {
      state.degraded = true;
      state.degradedReasons.push(support.reason);
    }
    skeleton = await runToolWithContext(context, "code_read", { filePath, view: "skeleton" }, progress);
  }

  const shouldRunFileProfile = !setup.hasDeadline || setup.timeRemaining() > 500;
  if (shouldRunFileProfile) {
    await runToolWithContext(context, "file_profile", { filePath }, progress);
  } else {
    state.degraded = true;
    if (!state.degradedReasons.includes("budget_exceeded")) {
      state.degradedReasons.push("budget_exceeded");
    }
    if (setup.traceBuilder) {
      setup.traceBuilder.recordSkip("file_profile", "budget_exceeded", "timeout guard");
    }
  }

  const projectStats = setup.initialProjectStats;
  const budget = BudgetManager.create({
    category: "understand",
    queryLength: setup.metrics.length,
    tokenCount: setup.metrics.tokenCount,
    strongQuery: setup.metrics.strong,
    includeGraph: setup.includeDependenciesPlanned || setup.includeCallsPlanned,
    includeHotSpots: setup.includeHotSpotsPlanned,
    projectStats: { fileCount: projectStats?.fileCount }
  });

  let calls: any = null;
  let callGraphArtifactId: string | undefined;
  let callGraphSummary: GraphPack["summary"] | undefined;
  let callGraphPreview: { nodes: any[]; edges: any[]; resolvedTarget?: any; meta?: any } | undefined;
  let deps: any = null;
  let hotSpots: any = [];

  const allowGraphs = resolveAllowGraphs({
    isDocument,
    strongQuery: setup.metrics.strong,
    budgetProfile: budget.profile,
    includeCalls: setup.includeCallsPlanned,
    includeDependencies: setup.includeDependenciesPlanned,
    includeHotSpots: setup.includeHotSpotsPlanned
  });
  if (isDocument && (setup.includeCallsPlanned || setup.includeDependenciesPlanned || setup.includeHotSpotsPlanned)) {
    state.degraded = true;
    state.refinementReason = state.refinementReason ?? "document_file";
  }
  const enoughTimeForCalls = !setup.hasDeadline || setup.timeRemaining() > 900;
  const enoughTimeForDeps = !setup.hasDeadline || setup.timeRemaining() > 800;
  const enoughTimeForHotSpots = !setup.hasDeadline || setup.timeRemaining() > 700;
  if (setup.includeCallsPlanned && symbolName && allowGraphs && enoughTimeForCalls) {
    calls = await fetchCallGraph({
      context,
      filePath,
      symbolName,
      depth: setup.depth,
      runTool: runToolWithContext,
      progress
    });
  } else if (setup.includeCallsPlanned && symbolName && (!allowGraphs || !enoughTimeForCalls)) {
    state.degraded = true;
    state.refinementReason = state.refinementReason ?? "budget_exceeded";
    if (!state.degradedReasons.includes("budget_exceeded")) {
      state.degradedReasons.push("budget_exceeded");
    }
    if (setup.traceBuilder) {
      setup.traceBuilder.recordSkip("call_graph", "budget_exceeded", "graph budget gated");
    }
  }
  if (calls) {
    const graphPackResult = buildGraphPack({
      calls,
      filePath,
      symbolName,
      depth: setup.depth
    });
    callGraphArtifactId = graphPackResult.pack.id;
    callGraphSummary = graphPackResult.pack.summary;
    callGraphPreview = graphPackResult.preview;
    if (artifactManager) {
      artifactManager.store({
        id: graphPackResult.pack.id,
        type: "graph",
        createdAt: graphPackResult.pack.meta.createdAt,
        expiresAt: graphPackResult.expiresAt,
        pack: graphPackResult.pack,
        sessionId: setup.input.resolvedSessionId,
        metadata: { intent: setup.input.subject }
      });
    }
  }

  if (setup.includeDependenciesPlanned && allowGraphs && enoughTimeForDeps) {
    deps = await collectDependenciesFromGraph(ucg, filePath, context);

    if (!deps || !Array.isArray(deps.edges) || deps.edges.length === 0) {
      deps = await runToolWithContext(context, "relationship_analyze", {
        target: filePath,
        mode: "dependencies",
        direction: "both"
      }, progress);
    }
  } else if (setup.includeDependenciesPlanned && (!allowGraphs || !enoughTimeForDeps)) {
    state.degraded = true;
    state.refinementReason = state.refinementReason ?? "budget_exceeded";
    if (!state.degradedReasons.includes("budget_exceeded")) {
      state.degradedReasons.push("budget_exceeded");
    }
    if (setup.traceBuilder) {
      setup.traceBuilder.recordSkip("dependencies", "budget_exceeded", "graph budget gated");
    }
  }

  if (setup.includeHotSpotsPlanned && allowGraphs && enoughTimeForHotSpots) {
    hotSpots = await runToolWithContext(context, "hotspot_detect", {}, progress);
  } else if (setup.includeHotSpotsPlanned && (!allowGraphs || !enoughTimeForHotSpots)) {
    state.degraded = true;
    state.refinementReason = state.refinementReason ?? "budget_exceeded";
    if (!state.degradedReasons.includes("budget_exceeded")) {
      state.degradedReasons.push("budget_exceeded");
    }
    if (setup.traceBuilder) {
      setup.traceBuilder.recordSkip("hot_spots", "budget_exceeded", "graph budget gated");
    }
  }

  let fallbackGraph: { mode: "l2"; edges: Array<{ from: string; to: string; confidence: "low"; reason?: string }>; evidence?: string[] } | undefined = undefined;
  const shouldAttemptFallbackGraph =
    !isDocument
    && shouldBuildFallbackGraph(state.degradedReasons)
    // Fallback graph extraction is comparatively cheap (single full read + import parse),
    // so keep it enabled unless we're extremely close to timeout.
    && (!setup.hasDeadline || setup.timeRemaining() > 250);
  if (shouldAttemptFallbackGraph) {
    fallbackGraph = await buildFallbackGraph(filePath, runToolWithContext);
    if (setup.traceBuilder) {
      setup.traceBuilder.recordEvent({
        area: "capabilities",
        code: "fallback_graph",
        message: "Using fallback graph extraction",
        data: { filePathHint: path.basename(filePath) }
      });
    }
  }

  const compressionDecision = applySkeletonCompressionDecision({
    skeleton: typeof skeleton === "string" ? skeleton : String(skeleton ?? ""),
    filePath,
    maxTokens: setup.maxTokens,
    languageId: AstManager.getInstance().getLanguageId(filePath),
    buildDigest: () => buildSkeletonDigest(profileFromSetup(setup)),
    applyTokenBudget
  });
  skeleton = compressionDecision.skeleton;
  if (compressionDecision.degraded) {
    state.degraded = true;
    if (compressionDecision.degradedReason && !state.degradedReasons.includes(compressionDecision.degradedReason)) {
      state.degradedReasons.push(compressionDecision.degradedReason);
    }
  }

  return {
    state,
    data: {
      filePath,
      symbolName,
      isDocument,
      skeleton,
      docProfile,
      docReferences,
      relatedCode,
      mentionMatches,
      calls,
      callGraphArtifactId,
      callGraphSummary,
      callGraphPreview,
      deps,
      hotSpots,
      fallbackGraph,
      refinementReason: state.refinementReason,
      allowGraphs,
      compressionDecision,
      budget,
      projectStats,
      searchResult
    }
  };
}

function profileFromSetup(setup: UnderstandExecutionSetup) {
  return setup.profile ?? "balanced";
}

async function buildFallbackGraph(
  filePath: string,
  runTool: (context: OrchestrationContext, tool: string, args: any, progress?: ProgressState) => Promise<any>
): Promise<{ mode: "l2"; edges: Array<{ from: string; to: string; confidence: "low"; reason?: string }>; evidence?: string[] } | undefined> {
  let content = "";
  try {
    const full = await runTool(new OrchestrationContext(), "code_read", { filePath, view: "full" });
    content = typeof full === "string" ? full : (full?.content ?? "");
  } catch {
    content = "";
  }
  if (!content) return undefined;

  const languageId = AstManager.getInstance().getLanguageId(filePath);
  const extractor = new UniversalFallbackExtractor();
  const imports = extractor.extractImports(content, languageId);
  if (!imports || imports.length === 0) {
    return undefined;
  }

  const edges = imports.map((entry) => ({
    from: filePath,
    to: entry.source ?? entry.name,
    confidence: "low" as const,
    reason: "regex_imports"
  }));

  return {
    mode: "l2",
    edges,
    evidence: ["regex_imports"]
  };
}
