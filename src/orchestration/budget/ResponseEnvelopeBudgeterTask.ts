import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { truncate } from "../pillars/explore/ResultFormatter.js";
import { DEFAULT_ELASTIC_WINDOW_PCT, MIN_PREVIEW_CHARS } from "./ResponseEnvelopeBudgeterConstants.js";
import type { EnvelopeBudgetResult, TaskResponseBudgetOptions } from "./ResponseEnvelopeBudgeterTypes.js";
import { estimateResponseUsage, markBudgetExceededWithReasons, recordBudgetAction, recordTrace, withinBudget } from "./ResponseEnvelopeBudgeterUtils.js";

export function enforceTaskResponseBudget(args: {
  response: Record<string, any>;
  maxTokens?: number;
  maxChars?: number;
  traceBuilder?: TraceBuilder;
  minEvidenceItems?: number;
  minExcerptChars?: number;
}): EnvelopeBudgetResult {
  const options: TaskResponseBudgetOptions = {
    maxTokens: args.maxTokens,
    maxChars: args.maxChars,
    traceBuilder: args.traceBuilder,
    minEvidenceItems: args.minEvidenceItems,
    minExcerptChars: args.minExcerptChars
  };
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

  const ensureEvidenceCount = () => {
    if (!Array.isArray(response.evidence)) return false;
    const minItems = Number.isFinite(options.minEvidenceItems) ? options.minEvidenceItems! : 0;
    if (response.evidence.length <= minItems) return false;
    response.evidence = response.evidence.slice(0, Math.max(0, minItems));
    recordBudgetAction(options.traceBuilder, "budget.response.trim_lists", { field: "evidence", limit: minItems });
    return true;
  };

  const trimEvidenceExcerpts = (maxChars: number) => {
    if (!Array.isArray(response.evidence)) return false;
    let changed = false;
    for (const item of response.evidence) {
      if (typeof item?.excerpt !== "string") continue;
      if (item.excerpt.length <= maxChars) continue;
      item.excerpt = truncate(item.excerpt, maxChars);
      item.truncated = true;
      changed = true;
    }
    if (changed) {
      recordBudgetAction(options.traceBuilder, "budget.response.trim_items", { field: "evidence", maxChars });
    }
    return changed;
  };

  const dropEvidenceExcerpts = () => {
    if (!Array.isArray(response.evidence)) return false;
    let changed = false;
    for (const item of response.evidence) {
      if (item && Object.prototype.hasOwnProperty.call(item, "excerpt")) {
        delete item.excerpt;
        changed = true;
      }
    }
    if (changed) {
      recordBudgetAction(options.traceBuilder, "budget.response.drop_field", { field: "evidence.excerpt" });
    }
    return changed;
  };

  const dropEvidence = () => {
    if (!Array.isArray(response.evidence) || response.evidence.length === 0) return false;
    response.evidence = [];
    recordBudgetAction(options.traceBuilder, "budget.response.drop_field", { field: "evidence" });
    return true;
  };

  dropField("details");
  usage = estimateResponseUsage(response);
  if (withinBudget(usage, options)) {
    recordTrace(options.traceBuilder, usage, options, true);
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
    markBudgetExceededWithReasons(response);
    return { applied: true, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
  }

  if (ensureEvidenceCount()) {
    applied = true;
    usage = estimateResponseUsage(response);
  }
  if (withinBudget(usage, options)) {
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
    markBudgetExceededWithReasons(response);
    recordTrace(options.traceBuilder, usage, options, true);
    return { applied: true, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
  }

  const excerptChars = Number.isFinite(options.minExcerptChars) ? options.minExcerptChars! : MIN_PREVIEW_CHARS;
  if (trimEvidenceExcerpts(excerptChars)) {
    applied = true;
    usage = estimateResponseUsage(response);
  }
  if (withinBudget(usage, options)) {
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
    markBudgetExceededWithReasons(response);
    recordTrace(options.traceBuilder, usage, options, true);
    return { applied: true, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
  }

  dropField("decisionTrace");
  usage = estimateResponseUsage(response);
  if (withinBudget(usage, options)) {
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
    markBudgetExceededWithReasons(response);
    recordTrace(options.traceBuilder, usage, options, true);
    return { applied: true, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
  }

  if (dropEvidenceExcerpts()) {
    applied = true;
    usage = estimateResponseUsage(response);
  }
  if (withinBudget(usage, options)) {
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
    markBudgetExceededWithReasons(response);
    recordTrace(options.traceBuilder, usage, options, true);
    return { applied: true, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
  }

  if (dropEvidence()) {
    applied = true;
    usage = estimateResponseUsage(response);
  }

  if (applied) {
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
    markBudgetExceededWithReasons(response);
    recordTrace(options.traceBuilder, usage, options, true);
    return { applied: true, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
  }

  recordTrace(options.traceBuilder, usage, options, false);
  return { applied: false, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
}
