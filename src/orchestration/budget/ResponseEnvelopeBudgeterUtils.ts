import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { estimateTokens } from "../TokenBudget.js";
import { buildDegradedReasons } from "../DegradedReasonMapper.js";
import { truncate } from "../pillars/explore/ResultFormatter.js";
import { DEFAULT_ELASTIC_WINDOW_PCT } from "./ResponseEnvelopeBudgeterConstants.js";
import type { EnvelopeBudgetOptions } from "./ResponseEnvelopeBudgeterTypes.js";

export function estimateResponseUsage(response: unknown): { estimatedTokens: number; usedChars: number; serialized: string } {
  const serialized = JSON.stringify(response ?? {});
  return {
    serialized,
    usedChars: serialized.length,
    estimatedTokens: estimateTokens(serialized, { languageId: "json" })
  };
}

export function withinBudget(usage: { estimatedTokens: number; usedChars: number }, options: EnvelopeBudgetOptions): boolean {
  const overTokens = typeof options.maxTokens === "number" && options.maxTokens > 0
    ? usage.estimatedTokens > Math.ceil(options.maxTokens * (1 + DEFAULT_ELASTIC_WINDOW_PCT))
    : false;
  const overChars = typeof options.maxChars === "number" && options.maxChars > 0
    ? usage.usedChars > options.maxChars
    : false;
  return !overTokens && !overChars;
}

export function recordTrace(
  traceBuilder: TraceBuilder | undefined,
  usage: { estimatedTokens: number; usedChars: number },
  options: EnvelopeBudgetOptions,
  applied: boolean
) {
  if (!traceBuilder) return;
  traceBuilder.recordEvent({
    area: "budget",
    code: applied ? "budget.response.enforced" : "budget.response.estimated",
    data: {
      estimatedTokens: usage.estimatedTokens,
      usedChars: usage.usedChars,
      maxTokens: options.maxTokens,
      maxChars: options.maxChars
    }
  });
}

export function recordBudgetAction(traceBuilder: TraceBuilder | undefined, code: string, data?: Record<string, unknown>) {
  if (!traceBuilder) return;
  traceBuilder.recordEvent({
    area: "budget",
    code,
    ...(data ? { data } : {})
  });
}

export function markBudgetExceeded(response: { degraded?: boolean; reasons?: string[] }): void {
  response.degraded = true;
  response.reasons = Array.from(new Set([...(response.reasons ?? []), "budget_exceeded"]));
}

export function markBudgetExceededWithReasons(response: { degraded?: boolean; degradedReasons?: any[] }): void {
  response.degraded = true;
  const existing = Array.isArray(response.degradedReasons) ? response.degradedReasons : [];
  if (existing.some((reason) => reason?.type === "budget_exceeded")) {
    response.degradedReasons = existing;
    return;
  }
  const additions = buildDegradedReasons(["budget_exceeded"]) ?? [];
  response.degradedReasons = [...existing, ...additions];
}

export function truncateStringField(
  response: Record<string, any>,
  key: string,
  maxChars: number,
  traceBuilder?: TraceBuilder
): boolean {
  const value = response[key];
  if (typeof value !== "string" || value.length <= maxChars) return false;
  response[key] = truncate(value, maxChars);
  recordBudgetAction(traceBuilder, "budget.response.truncate_field", { field: key, maxChars });
  return true;
}

export function trimArrayField(
  response: Record<string, any>,
  key: string,
  limit: number,
  traceBuilder?: TraceBuilder
): boolean {
  const value = response[key];
  if (!Array.isArray(value) || value.length <= limit) return false;
  response[key] = value.slice(0, limit);
  recordBudgetAction(traceBuilder, "budget.response.trim_lists", { field: key, limit });
  return true;
}
