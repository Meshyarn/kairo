import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import { ReviewReportBuilder } from "../../../generation/review-report-builder.js";

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

export const createSymbolicTraceRecorder = (traceBuilder?: { recordEvent?: (event: any) => void; recordSkip?: (area: string, code: string, reason: string) => void }) => {
  let recorded = false;
  return (review: any, phase?: string) => {
    if (!traceBuilder || recorded) return;
    const semantic = review?.semantic;
    const symbolic = semantic?.stats?.symbolic;
    if (!symbolic) return;
    const diagnosticsCount = Array.isArray(semantic.diagnostics) ? semantic.diagnostics.length : 0;
    const degraded = Array.isArray(semantic.degradedReasons) && semantic.degradedReasons.length > 0;
    traceBuilder.recordEvent?.({
      area: "guardrails",
      code: "symbolic_guards",
      data: {
        enabled: symbolic.enabled,
        mode: symbolic.mode,
        queryUsed: symbolic.queryUsed,
        solverUsed: symbolic.solverUsed,
        constraintsBuilt: symbolic.constraintsBuilt,
        pathsExplored: symbolic.pathsExplored,
        diagnostics: diagnosticsCount,
        degraded,
        ...(phase ? { phase } : {})
      }
    });
    recorded = true;
    if (symbolic.enabled === false || symbolic.mode === "off") {
      traceBuilder.recordSkip?.("symbolic_guards", "policy_disabled", "symbolic guards disabled");
      return;
    }
    if (symbolic.queryUsed === false) {
      traceBuilder.recordSkip?.("symbolic_guards", "unsupported", "symbolic guard query missing or unsupported language");
      return;
    }
    if (Array.isArray(semantic.degradedReasons) && semantic.degradedReasons.some((item: any) => item?.type === "budget_exceeded")) {
      traceBuilder.recordSkip?.("symbolic_guards", "budget_exceeded", "symbolic guard budget exceeded");
    }
  };
};

export const runReviewWithTrace = async (args: {
  filePath: string;
  content: string;
  oldContent: string;
  guardrailResult?: any;
  constraints: any;
  stylePack?: any;
  contractImpact?: any;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
  strictness?: "strict" | "balanced" | "permissive";
  traceBuilder?: { recordEvent?: (event: any) => void };
  recordSymbolicTrace?: (review: any, phase?: string) => void;
  phase?: string;
}): Promise<any> => {
  const review = await new ReviewReportBuilder(
    { dependencyGraph: args.dependencyGraph, indexStateManager: args.indexStateManager },
    { strictness: args.strictness }
  ).review({
    filePath: args.filePath,
    content: args.content,
    oldContent: args.oldContent,
    guardrailResult: args.guardrailResult,
    constraints: args.constraints,
    stylePack: args.stylePack,
    contractImpact: args.contractImpact
  });

  if (args.traceBuilder && review?.semantic) {
    args.traceBuilder.recordEvent?.({
      area: "other",
      code: "semantic_validation",
      data: {
        verdict: review.semantic.verdict,
        diagnostics: Array.isArray(review.semantic.diagnostics) ? review.semantic.diagnostics.length : 0,
        durationMs: review.semantic.stats?.durationMs,
        degraded: Array.isArray(review.semantic.degradedReasons) && review.semantic.degradedReasons.length > 0,
        ...(args.phase ? { phase: args.phase } : {})
      }
    });
    args.recordSymbolicTrace?.(review, args.phase);
  }
  return review;
};

export const evaluatePreApplyReviewBlock = async (args: {
  filePath: string;
  content: string;
  oldContent: string;
  guardrailResult?: any;
  constraints: any;
  stylePack?: any;
  contractImpact?: any;
  reviewOptions: any;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
  traceBuilder?: { recordEvent?: (event: any) => void };
  recordSymbolicTrace?: (review: any, phase?: string) => void;
  bypassReviewBlock: boolean;
  workflowWarnings: string[];
  artifactManager?: FlowArtifactManager;
  resolvedSessionId?: string;
  originalIntent: string;
}): Promise<{ review?: any; blockedResponse?: Record<string, any>; computed: boolean }> => {
  const blockOn = Array.isArray(args.reviewOptions?.blockOn) ? args.reviewOptions.blockOn : [];
  const strictness = args.reviewOptions?.strictness;
  const resolvedStrictness =
    strictness === "strict" || strictness === "balanced" || strictness === "permissive"
      ? strictness
      : undefined;
  const review = await runReviewWithTrace({
    filePath: args.filePath,
    content: args.content,
    oldContent: args.oldContent,
    guardrailResult: args.guardrailResult,
    constraints: args.constraints,
    stylePack: args.stylePack,
    contractImpact: args.contractImpact,
    dependencyGraph: args.dependencyGraph,
    indexStateManager: args.indexStateManager,
    strictness: resolvedStrictness,
    traceBuilder: args.traceBuilder,
    recordSymbolicTrace: args.recordSymbolicTrace,
    phase: "pre_apply"
  });

  const blockReasons = collectBlockReasons(review, blockOn);
  if (blockReasons.length > 0) {
    if (args.bypassReviewBlock) {
      args.workflowWarnings.push("Override bypassed pre-apply review blocking for this apply.");
    } else {
      if (args.artifactManager) {
        args.artifactManager.store({
          id: review.id,
          type: "review",
          createdAt: review.reviewedAt,
          report: review,
          sessionId: args.resolvedSessionId,
          metadata: { intent: args.originalIntent }
        });
      }
      const message = `Review blocked by ${blockReasons.map((item) => `${item.kind}(${item.verdict})`).join(", ")}.`;
      return {
        review,
        computed: true,
        blockedResponse: {
          success: false,
          status: "blocked",
          message,
          operation: "apply",
          targetFile: args.filePath,
          review,
          reviewBlockReasons: blockReasons,
          blockedReason: "review_blocked",
          guidance: {
            message,
            reviewBlockReasons: blockReasons,
            suggestedActions: [
              {
                id: "change.review",
                priority: 1,
                description: "Review findings before applying changes.",
                rationale: "Review is required to resolve blocking issues.",
                toolCall: { tool: "change", args: { action: "review", target: args.filePath } }
              }
            ]
          },
          sessionId: args.resolvedSessionId
        }
      };
    }
  }
  return { review, computed: true };
};
