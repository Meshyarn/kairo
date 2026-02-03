import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import { evaluateIntegrityGuardrails, normalizeGuardrailContent, resolveGuardrailTargetPath } from "../../guardrails/IntegrityGuardrails.js";
import { ReviewReportBuilder } from "../../../generation/review-report-builder.js";
import type { TraceBuilder } from "../../trace/TraceBuilder.js";

export const evaluateGuardrails = async (args: {
  targetPath: string;
  oldContent: string;
  newContent: string;
  constraints: any;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
  runTool: (tool: string, toolArgs: any) => Promise<any>;
  applyMode: boolean;
}): Promise<any> => {
  const guardrailTargetPath = resolveGuardrailTargetPath(args.targetPath);
  return evaluateIntegrityGuardrails({
    targetPath: guardrailTargetPath,
    oldContent: normalizeGuardrailContent(args.oldContent),
    newContent: normalizeGuardrailContent(args.newContent),
    dependencyGraph: args.dependencyGraph,
    indexStateManager: args.indexStateManager,
    constraints: args.constraints,
    runTool: (tool, toolArgs) => args.runTool(tool, toolArgs),
    applyMode: args.applyMode
  });
};

const collectBlockReasons = (
  report: {
    syntax?: { verdict?: string };
    semantic?: { verdict?: string };
    guardrails?: { verdict?: string };
    vibeAlignment?: { verdict?: string };
  },
  blockOn: string[]
): Array<{ kind: string; verdict: string }> => {
  const reasons: Array<{ kind: string; verdict: string }> = [];
  for (const kind of blockOn) {
    switch (kind) {
      case "syntax": {
        const verdict = report.syntax?.verdict;
        if (verdict && verdict !== "pass") reasons.push({ kind, verdict });
        break;
      }
      case "semantic": {
        const verdict = report.semantic?.verdict;
        if (verdict && verdict !== "pass") reasons.push({ kind, verdict });
        break;
      }
      case "guardrails": {
        const verdict = report.guardrails?.verdict;
        if (verdict && verdict !== "pass") reasons.push({ kind, verdict });
        break;
      }
      case "vibe": {
        const verdict = report.vibeAlignment?.verdict;
        if (verdict && verdict !== "pass") reasons.push({ kind, verdict });
        break;
      }
      default:
        break;
    }
  }
  return reasons;
};

export const checkReviewBlock = async (params: {
  filePath: string;
  content: string;
  oldContent: string;
  guardrailResult?: any;
  constraints?: any;
  reviewOptions: any;
  stylePack?: any;
  overrideBypass?: boolean;
  traceBuilder?: TraceBuilder;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
}): Promise<{ blocked: boolean; review?: any; message?: string; reasons?: Array<{ kind: string; verdict: string }> }> => {
  const blockOn = Array.isArray(params.reviewOptions?.blockOn) ? params.reviewOptions.blockOn : [];
  if (blockOn.length === 0) {
    return { blocked: false };
  }

  const review = await new ReviewReportBuilder(
    {
      dependencyGraph: params.dependencyGraph,
      indexStateManager: params.indexStateManager
    },
    { strictness: params.reviewOptions?.strictness }
  ).review({
    filePath: params.filePath,
    content: params.content,
    oldContent: params.oldContent,
    guardrailResult: params.guardrailResult,
    constraints: params.constraints,
    stylePack: params.stylePack
  });
  if (params.traceBuilder && review?.semantic) {
    params.traceBuilder.recordEvent({
      area: "other",
      code: "semantic_validation",
      data: {
        verdict: review.semantic.verdict,
        diagnostics: Array.isArray(review.semantic.diagnostics) ? review.semantic.diagnostics.length : 0,
        durationMs: review.semantic.stats?.durationMs,
        degraded: Array.isArray(review.semantic.degradedReasons) && review.semantic.degradedReasons.length > 0
      }
    });
    const symbolic = review.semantic.stats?.symbolic;
    if (symbolic) {
      params.traceBuilder.recordEvent({
        area: "guardrails",
        code: "symbolic_guards",
        data: {
          enabled: symbolic.enabled,
          mode: symbolic.mode,
          queryUsed: symbolic.queryUsed,
          solverUsed: symbolic.solverUsed,
          constraintsBuilt: symbolic.constraintsBuilt,
          pathsExplored: symbolic.pathsExplored,
          diagnostics: Array.isArray(review.semantic.diagnostics) ? review.semantic.diagnostics.length : 0,
          degraded: Array.isArray(review.semantic.degradedReasons) && review.semantic.degradedReasons.length > 0
        }
      });
      if (symbolic.enabled === false || symbolic.mode === "off") {
        params.traceBuilder.recordSkip("symbolic_guards", "policy_disabled", "symbolic guards disabled");
      } else if (symbolic.queryUsed === false) {
        params.traceBuilder.recordSkip("symbolic_guards", "unsupported", "symbolic guard query missing or unsupported language");
      } else if (Array.isArray(review.semantic.degradedReasons)
        && review.semantic.degradedReasons.some((item: any) => item?.type === "budget_exceeded")) {
        params.traceBuilder.recordSkip("symbolic_guards", "budget_exceeded", "symbolic guard budget exceeded");
      }
    }
  }

  const reasons = collectBlockReasons(review, blockOn);
  if (reasons.length === 0) {
    return { blocked: false, review, reasons };
  }
  if (params.overrideBypass) {
    return { blocked: false, review, reasons, message: "Review block was bypassed by override." };
  }
  return {
    blocked: true,
    review,
    reasons,
    message: `Review blocked by ${reasons.map((item) => `${item.kind}(${item.verdict})`).join(", ")}.`
  };
};

export const checkStaleGuard = async (args: {
  indexStateManager?: IndexStateManager;
  dryRun: boolean;
  bypass: boolean;
  workflowWarnings: string[];
}): Promise<{ blocked: boolean; message: string; snapshot?: any }> => {
  if (args.dryRun || !args.indexStateManager) {
    return { blocked: false, message: "" };
  }
  const snapshot = await args.indexStateManager.getSnapshot();
  if (snapshot.staleRisk !== "high") {
    return { blocked: false, message: "", snapshot };
  }
  if (args.bypass) {
    args.workflowWarnings.push("Override bypassed stale index guard.");
    return { blocked: false, message: "", snapshot };
  }
  return {
    blocked: true,
    message: "Index staleness is high; reindex before apply.",
    snapshot
  };
};
