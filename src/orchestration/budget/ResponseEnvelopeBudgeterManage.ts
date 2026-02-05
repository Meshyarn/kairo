import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { DEFAULT_ELASTIC_WINDOW_PCT } from "./ResponseEnvelopeBudgeterConstants.js";
import type { EnvelopeBudgetOptions, EnvelopeBudgetResult } from "./ResponseEnvelopeBudgeterTypes.js";
import { compactArtifact } from "./ResponseEnvelopeBudgeterCompaction.js";
import { estimateResponseUsage, markBudgetExceededWithReasons, recordBudgetAction, recordTrace, withinBudget } from "./ResponseEnvelopeBudgeterUtils.js";

export function enforceManageResponseBudget(args: {
  response: Record<string, any>;
  maxTokens?: number;
  maxChars?: number;
  traceBuilder?: TraceBuilder;
}): EnvelopeBudgetResult {
  const options: EnvelopeBudgetOptions = { maxTokens: args.maxTokens, maxChars: args.maxChars, traceBuilder: args.traceBuilder };
  if (!options.maxTokens && !options.maxChars) {
    const usage = estimateResponseUsage(args.response);
    recordTrace(options.traceBuilder, usage, options, false);
    return { applied: false, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
  }

  const response = args.response;
  let usage = estimateResponseUsage(response);
  if (withinBudget(usage, options)) {
    recordTrace(options.traceBuilder, usage, options, false);
    return { applied: false, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
  }

  let applied = false;
  const dropResultField = (key: string) => {
    if (response.result && response.result[key] !== undefined) {
      response.result[key] = undefined;
      applied = true;
      recordBudgetAction(options.traceBuilder, "budget.response.drop_field", { field: `result.${key}` });
    }
  };

  if (response.result?.artifact) {
    response.result.artifact = compactArtifact(response.result.artifact);
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.compact_field", { field: "result.artifact" });
    usage = estimateResponseUsage(response);
  }

  if (!withinBudget(usage, options) && response.result?.view) {
    response.result.view = undefined;
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.drop_field", { field: "result.view" });
    usage = estimateResponseUsage(response);
  }

  const heavyKeys = [
    "capabilityDiagnostics",
    "capabilityHints",
    "embeddingDiagnostics",
    "embeddingFindings",
    "indexSnapshot",
    "status",
    "history",
    "artifacts",
    "sessions",
    "session",
    "metrics",
    "telemetry",
    "cost",
    "rollout",
    "drift",
    "budget"
  ];
  for (const key of heavyKeys) {
    if (withinBudget(usage, options)) break;
    dropResultField(key);
    usage = estimateResponseUsage(response);
  }

  if (!withinBudget(usage, options) && response.result) {
    response.result = {
      success: response.result.success ?? response.success,
      output: response.result.output ?? response.output
    };
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.compact_field", { field: "result" });
    usage = estimateResponseUsage(response);
  }

  if (applied) {
    markBudgetExceededWithReasons(response);
    response.stats = {
      ...(response.stats ?? {}),
      responseBudget: {
        applied: true,
        estimatedTokens: usage.estimatedTokens,
        usedChars: usage.usedChars,
        elasticWindowPct: DEFAULT_ELASTIC_WINDOW_PCT,
        maxTokens: options.maxTokens,
        maxChars: options.maxChars
      }
    };
    recordTrace(options.traceBuilder, usage, options, true);
  } else {
    recordTrace(options.traceBuilder, usage, options, false);
  }

  return { applied, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
}
