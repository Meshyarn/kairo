import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { DEFAULT_ELASTIC_WINDOW_PCT } from "./ResponseEnvelopeBudgeterConstants.js";
import type { EnvelopeBudgetOptions, EnvelopeBudgetResult } from "./ResponseEnvelopeBudgeterTypes.js";
import { estimateResponseUsage, markBudgetExceeded, recordBudgetAction, recordTrace, withinBudget } from "./ResponseEnvelopeBudgeterUtils.js";

export function enforceUnderstandResponseBudget(args: {
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
  const dropField = (key: string) => {
    if (response[key] !== undefined) {
      response[key] = undefined;
      applied = true;
      recordBudgetAction(options.traceBuilder, "budget.response.drop_field", { field: key });
    }
  };

  if (response.relationships?.calls) {
    response.relationships.calls = undefined;
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.drop_field", { field: "relationships.calls" });
  }
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("analysisPack");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("stylePack");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("integrity");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("indexSnapshot");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("clusters");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("clusterPolicy");

  const trimList = (key: string, limit: number) => {
    const list = response[key];
    if (Array.isArray(list) && list.length > limit) {
      response[key] = list.slice(0, limit);
      applied = true;
    }
  };

  if (!withinBudget(usage, options)) {
    trimList("symbols", 200);
    trimList("hotSpots", 20);
    recordBudgetAction(options.traceBuilder, "budget.response.trim_lists", { step: "trim_lists", symbols: 200, hotSpots: 20 });
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options)) {
    trimList("symbols", 50);
    trimList("hotSpots", 10);
    recordBudgetAction(options.traceBuilder, "budget.response.trim_lists", { step: "trim_lists", symbols: 50, hotSpots: 10 });
    usage = estimateResponseUsage(response);
  }

  if (!withinBudget(usage, options) && response.document?.relatedCode) {
    const related = response.document.relatedCode;
    if (Array.isArray(related) && related.length > 5) {
      response.document.relatedCode = related.slice(0, 5);
      applied = true;
      recordBudgetAction(options.traceBuilder, "budget.response.trim_lists", { step: "document.relatedCode", relatedCode: 5 });
      usage = estimateResponseUsage(response);
    }
  }

  if (!withinBudget(usage, options)) {
    dropField("decisionTrace");
    dropField("effectiveOptions");
    usage = estimateResponseUsage(response);
  }

  if (applied) {
    markBudgetExceeded(response);
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
