import type { ParsedIntent } from "../../IntentRouter.js";
import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { InternalToolRegistry } from "../../InternalToolRegistry.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import type { OptionSource, TraceOptionResolution } from "../../../types/option-trace.js";
import type { ToolProfile } from "../../options/OptionResolver.js";
import { BudgetManager } from "../../BudgetManager.js";
import { analyzeQuery } from "../../../engine/search/QueryMetrics.js";
import { TraceBuilder } from "../../trace/TraceBuilder.js";
import { buildBudgetPlan, getSectionPlan } from "../../budget/TokenBudgetAllocatorV2.js";
import { FeatureFlags } from "../../../config/FeatureFlags.js";
import { AdaptiveLodController } from "../../adaptive-flow/AdaptiveLodController.js";
import {
  computeAdaptiveFlowGate,
  recordAdaptiveFlowGateTrace,
  resolveRolloutPresetFromEnv,
  setAdaptiveFlowGate
} from "../../adaptive-flow/AdaptiveFlowGate.js";
import { normalizeUnderstandInput } from "./UnderstandInputNormalizer.js";
import { resolveProgressState, type ProgressState } from "../../../utils/ProgressLogger.js";

export interface UnderstandExecutionSetup {
  input: ReturnType<typeof normalizeUnderstandInput>;
  depth: string;
  include: Record<string, any>;
  maxTokens?: number;
  profile?: ToolProfile;
  traceBuilder?: TraceBuilder;
  budgetPlan: ReturnType<typeof buildBudgetPlan>;
  analysisPlan?: ReturnType<typeof getSectionPlan>;
  stylePlan?: ReturnType<typeof getSectionPlan>;
  relatedCodeLimit?: number;
  includeCallsPlanned: boolean;
  includeDependenciesPlanned: boolean;
  includeHotSpotsPlanned: boolean;
  wantsVibePlanned: boolean;
  wantsAnalysisPlanned: boolean;
  budgetOmissions: Array<"dependencies" | "call_graph" | "hot_spots" | "analysis_pack" | "style_pack">;
  metrics: ReturnType<typeof analyzeQuery>;
  initialProjectStats?: any;
  initialBudget?: ReturnType<typeof BudgetManager.create>;
  searchBudget?: ReturnType<typeof BudgetManager.create>;
  progress: ProgressState | undefined;
  startedAt: number;
  adaptiveLod?: AdaptiveLodController;
}

const resolveOptionSource = (explicit: boolean, hasSession: boolean): OptionSource => {
  if (explicit) return "explicit";
  if (hasSession) return "session";
  return "default";
};

const buildStringResolution = (
  resolved: string | undefined,
  explicit: boolean,
  hasSession: boolean,
  requested?: unknown
): TraceOptionResolution<string | null> => ({
  source: resolveOptionSource(explicit, hasSession),
  explicit,
  resolved: resolved ?? null,
  ...(requested !== undefined ? { requested } : {})
});

export async function initializeUnderstandExecution(args: {
  intent: ParsedIntent;
  context: OrchestrationContext;
  registry: InternalToolRegistry;
  startedAt: number;
  runTool: (context: OrchestrationContext, tool: string, args: any, progress?: ProgressState) => Promise<any>;
  extractPath: (value: string | undefined | null) => string | null;
  extractSymbol: (value: string | undefined | null) => string | null;
}): Promise<UnderstandExecutionSetup> {
  const { intent, context, registry, startedAt, runTool, extractPath, extractSymbol } = args;
  const artifactManager = registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
  const input = normalizeUnderstandInput(intent, {
    resolveSessionId: (rawSessionId, fallback) => artifactManager?.resolveSessionId(rawSessionId, fallback),
    getSessionPolicy: (sessionId) => (sessionId ? artifactManager?.getSession(sessionId)?.policy : undefined),
    extractPath,
    extractSymbol
  });
  let depth = input.depth;
  const include = input.include;
  let maxTokens = input.maxTokens;
  let profile: ToolProfile | undefined = input.resolvedOptions.effective.profile as ToolProfile | undefined;
  const adaptiveLod = registry.getMetadata<AdaptiveLodController>("adaptiveLodController");
  const profileExplicit = typeof input.constraints.profile === "string";
  const adaptiveDecision = adaptiveLod?.resolveProfile({
    sessionId: input.resolvedSessionId,
    tool: "understand",
    requestedProfile: profile ?? "balanced",
    explicit: profileExplicit
  });
  if (adaptiveDecision?.downshifted) {
    profile = adaptiveDecision.profile;
    if (!profileExplicit && typeof input.constraints.depth !== "string") {
      if (profile === "lean" || profile === "fast") depth = "shallow";
      if (profile === "deep") depth = "deep";
    }
    if (profile === "lean") {
      if (typeof input.limits.maxTokens !== "number") input.limits.maxTokens = 1600;
      if (typeof input.limits.timeoutMs !== "number") input.limits.timeoutMs = 4000;
      maxTokens = 1600;
    }
    if (profile === "fast" && typeof input.limits.maxTokens !== "number") {
      maxTokens = maxTokens ?? 1600;
    }
  }
  input.resolvedOptions.effective.profile = profile;

  const progress = resolveProgressState("Understand", input.constraints);
  const sessionProfile = input.sessionPolicy?.understand?.profile ?? input.sessionPolicy?.profile;
  const sessionSources = input.sessionPolicy?.understand?.sources ?? input.sessionPolicy?.sources;
  const traceBuilder = input.traceEnabled
    ? new TraceBuilder(
      "understand",
      {
        profile: buildStringResolution(
          profile,
          typeof input.constraints.profile === "string",
          Boolean(sessionProfile),
          typeof input.constraints.profile === "string" ? input.constraints.profile : undefined
        ),
        sources: buildStringResolution(
          input.resolvedOptions.effective.sources,
          typeof input.constraints.sources === "string",
          Boolean(sessionSources),
          typeof input.constraints.sources === "string" ? input.constraints.sources : undefined
        ),
        trace: {
          source: input.constraints.trace === true ? "explicit" : "default",
          explicit: input.constraints.trace === true,
          resolved: input.traceEnabled
        }
      },
      { startedAtMs: startedAt }
    )
    : undefined;
  if (traceBuilder) {
    traceBuilder.setBudget({ maxTokens });
  }
  if (traceBuilder && adaptiveDecision?.downshifted) {
    traceBuilder.recordEvent({
      area: "budget",
      code: "adaptive_lod.downshift",
      data: {
        from: input.resolvedOptions.effective.profile ?? "balanced",
        to: profile,
        violationStreak: adaptiveDecision.violationStreak,
        stableScore: adaptiveDecision.stableScore,
        cooldownRemaining: adaptiveDecision.cooldownRemaining,
        reasonCodes: adaptiveDecision.reasonCodes
      }
    });
  }

  const budgetPlan = buildBudgetPlan({
    pillar: "understand",
    profile: (profile ?? "balanced") as ToolProfile,
    sources: input.resolvedOptions.effective.sources,
    maxTokens
  });
  let includeCallsPlanned = input.includeCalls;
  let includeDependenciesPlanned = input.includeDependencies;
  let includeHotSpotsPlanned = include.hotSpots === true;
  let wantsVibePlanned = input.wantsVibe;
  let wantsAnalysisPlanned = input.wantsAnalysis;
  const relatedCodePlan = getSectionPlan(budgetPlan, "related_code");
  const analysisPlan = getSectionPlan(budgetPlan, "analysis_pack");
  const stylePlan = getSectionPlan(budgetPlan, "style_pack");
  const relatedCodeLimit = relatedCodePlan?.strategy === "summary"
    ? 1
    : (relatedCodePlan?.strategy === "preview" ? 3 : undefined);
  const budgetOmissions: Array<"dependencies" | "call_graph" | "hot_spots" | "analysis_pack" | "style_pack"> = [];

  const recordAllocatorEvents = () => {
    if (!traceBuilder) return;
    traceBuilder.recordEvent({
      area: "budget",
      code: "allocator.plan_created",
      data: {
        maxTokens: budgetPlan.maxTokens,
        maxChars: budgetPlan.maxChars,
        sectionCount: budgetPlan.sections.length
      }
    });
    for (const section of budgetPlan.sections) {
      traceBuilder.recordEvent({
        area: "budget",
        code: "allocator.section_strategy",
        data: {
          section: section.section,
          strategy: section.strategy,
          tokens: section.tokens,
          chars: section.chars
        }
      });
      if (section.strategy === "omit") {
        traceBuilder.recordSkip(section.section, "budget_exceeded", "allocator omitted section");
      }
    }
  };

  const applyBudgetOmit = (section: "dependencies" | "call_graph" | "hot_spots" | "analysis_pack" | "style_pack") => {
    budgetOmissions.push(section);
    if (section === "dependencies") includeDependenciesPlanned = false;
    if (section === "call_graph") includeCallsPlanned = false;
    if (section === "hot_spots") includeHotSpotsPlanned = false;
    if (section === "analysis_pack") wantsAnalysisPlanned = false;
    if (section === "style_pack") wantsVibePlanned = false;
  };

  for (const entry of budgetPlan.sections) {
    if (entry.strategy !== "omit") continue;
    if (entry.section === "dependencies") applyBudgetOmit("dependencies");
    if (entry.section === "call_graph") applyBudgetOmit("call_graph");
    if (entry.section === "hot_spots") applyBudgetOmit("hot_spots");
    if (entry.section === "analysis_pack") applyBudgetOmit("analysis_pack");
    if (entry.section === "style_pack") applyBudgetOmit("style_pack");
  }
  recordAllocatorEvents();

  const metrics = analyzeQuery(input.subject);
  let initialProjectStats = context.getState<any>("project_profile");
  if (!initialProjectStats) {
    try {
      initialProjectStats = await runTool(context, "project_profile", {}, progress);
      if (initialProjectStats) {
        context.setState("project_profile", initialProjectStats);
      }
    } catch {
      initialProjectStats = undefined;
    }
  }
  const initialBudget = BudgetManager.create({
    category: "understand",
    queryLength: metrics.length,
    tokenCount: metrics.tokenCount,
    strongQuery: metrics.strong,
    includeGraph: includeDependenciesPlanned || includeCallsPlanned,
    includeHotSpots: includeHotSpotsPlanned,
    projectStats: initialProjectStats?.fileCount ? { fileCount: initialProjectStats.fileCount } : undefined
  });
  const searchBudget = resolveSearchBudget(input.constraints, initialBudget);

  const gate = computeAdaptiveFlowGate({
    profile,
    fileCount: typeof initialProjectStats?.fileCount === "number" ? initialProjectStats.fileCount : undefined
  });
  setAdaptiveFlowGate(context, gate);
  if (traceBuilder) {
    recordAdaptiveFlowGateTrace(traceBuilder, gate, {
      rolloutMode: resolveRolloutPresetFromEnv() ?? FeatureFlags.getMode(FeatureFlags.ADAPTIVE_FLOW_ENABLED),
      userIdResolved: Boolean(FeatureFlags.getContext()?.userId)
    });
  }

  return {
    input,
    depth,
    include,
    maxTokens,
    profile,
    traceBuilder,
    budgetPlan,
    analysisPlan,
    stylePlan,
    relatedCodeLimit,
    includeCallsPlanned,
    includeDependenciesPlanned,
    includeHotSpotsPlanned,
    wantsVibePlanned,
    wantsAnalysisPlanned,
    budgetOmissions,
    metrics,
    initialProjectStats,
    initialBudget,
    searchBudget,
    progress,
    startedAt,
    adaptiveLod
  };
}

function resolveSearchBudget(
  constraints: any,
  budget?: ReturnType<typeof BudgetManager.create>
): ReturnType<typeof BudgetManager.create> | undefined {
  if (!budget) return undefined;
  const timeoutMs = Number.isFinite(constraints?.limits?.timeoutMs)
    ? constraints.limits.timeoutMs
    : undefined;
  if (!timeoutMs || timeoutMs <= 0) {
    return budget;
  }
  return {
    ...budget,
    maxParseTimeMs: Math.min(budget.maxParseTimeMs, timeoutMs)
  };
}
