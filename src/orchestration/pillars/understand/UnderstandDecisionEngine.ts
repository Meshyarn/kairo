import { applyTokenBudget } from "../../TokenBudget.js";
import { metrics } from "../../../utils/MetricsCollector.js";

export function resolveAllowGraphs(args: {
  isDocument: boolean;
  strongQuery: boolean;
  budgetProfile?: string | null;
  includeCalls: boolean;
  includeDependencies: boolean;
  includeHotSpots: boolean;
}): boolean {
  const stopTimer = metrics.startTimer("decision.understand_allow_graphs_ms", "detailed");
  try {
  if (args.isDocument) return false;
  if (!args.strongQuery) {
    return args.includeCalls || args.includeDependencies || args.includeHotSpots;
  }
  return (args.budgetProfile ?? null) !== "safe" || args.includeCalls || args.includeDependencies || args.includeHotSpots;
  } finally {
    stopTimer();
  }
}

export function shouldBuildFallbackGraph(degradedReasons: string[] | undefined): boolean {
  const stopTimer = metrics.startTimer("decision.understand_fallback_ms", "detailed");
  try {
  const reasons = Array.isArray(degradedReasons) ? degradedReasons : [];
  return reasons.some((reason) =>
    reason === "language_query_missing"
    || reason === "language_parser_unavailable"
    || reason === "unsupported_language"
    || reason === "missing_query_pack"
    || reason === "missing_wasm_grammar"
    || reason === "missing_syntax_validator"
  );
  } finally {
    stopTimer();
  }
}

export function applySkeletonCompressionDecision(args: {
  skeleton: string;
  filePath: string;
  maxTokens?: number;
  languageId?: string;
  buildDigest: () => string | undefined;
  applyTokenBudget?: typeof applyTokenBudget;
}): {
  skeleton: string;
  degraded: boolean;
  degradedReason?: "budget_exceeded";
  compression?: {
    applied: true;
    mode: "truncate" | "distill";
    elasticWindowPct?: number;
    maxTokens?: number;
    estimatedTokens?: number;
    maxChars?: number;
    usedChars?: number;
    decisions?: Array<{
      item: string;
      from: "full" | "skeleton" | "reference" | "summary";
      to: "full" | "skeleton" | "reference" | "summary";
      reason: "budget_exceeded" | "low_score" | "distance";
    }>;
  };
} {
  const stopTimer = metrics.startTimer("decision.understand_compression_ms", "detailed");
  try {
  const budget = (args.applyTokenBudget ?? applyTokenBudget)(args.skeleton, {
    maxTokens: args.maxTokens,
    maxChars: undefined,
    languageId: args.languageId
  });
  if (!budget.applied) {
    return { skeleton: args.skeleton, degraded: false };
  }

  const decisions: Array<{
    item: string;
    from: "full" | "skeleton" | "reference" | "summary";
    to: "full" | "skeleton" | "reference" | "summary";
    reason: "budget_exceeded" | "low_score" | "distance";
  }> = [];
  let mode: "truncate" | "distill" = "truncate";
  let skeleton = args.skeleton;

  const digest = args.buildDigest();
  if (digest) {
    skeleton = digest;
    mode = "distill";
    decisions.push({
      item: args.filePath,
      from: "skeleton",
      to: "summary",
      reason: "budget_exceeded"
    });
  } else {
    skeleton = budget.text;
  }

  return {
    skeleton,
    degraded: true,
    degradedReason: "budget_exceeded",
    compression: {
      applied: true,
      mode,
      elasticWindowPct: budget.elasticWindowPct,
      maxTokens: budget.maxTokens,
      estimatedTokens: budget.estimatedTokens,
      maxChars: budget.maxChars,
      usedChars: budget.usedChars,
      decisions: decisions.length > 0 ? decisions : undefined
    }
  };
  } finally {
    stopTimer();
  }
}
