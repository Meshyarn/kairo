import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { truncate } from "../pillars/explore/ResultFormatter.js";
import {
  DEFAULT_ELASTIC_WINDOW_PCT,
  MIN_PREVIEW_CHARS,
  MIN_EVIDENCE_ITEMS_FLOOR,
  MIN_EVIDENCE_EXCERPT_CHARS,
  MIN_FALLBACK_EXCERPT_CHARS
} from "./ResponseEnvelopeBudgeterConstants.js";
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
  const originalSize = usage.usedChars;
  let removedItems = 0;
  if (withinBudget(usage, options)) {
    recordTrace(options.traceBuilder, usage, options, false);
    return { applied: false, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
  }

  let applied = false;
  const policyMinItems = Number.isFinite(options.minEvidenceItems)
    ? options.minEvidenceItems!
    : MIN_EVIDENCE_ITEMS_FLOOR;
  const minEvidenceItems = Math.max(MIN_EVIDENCE_ITEMS_FLOOR, policyMinItems);

  const dropField = (key: string) => {
    if (response[key] !== undefined) {
      response[key] = undefined;
      applied = true;
      removedItems += 1;
      recordBudgetAction(options.traceBuilder, "budget.response.drop_field", { field: key });
    }
  };

  const ensureEvidenceCount = () => {
    if (!Array.isArray(response.evidence)) return false;
    if (response.evidence.length <= minEvidenceItems) return false;
    removedItems += response.evidence.length - minEvidenceItems;
    response.evidence = response.evidence.slice(0, minEvidenceItems);
    recordBudgetAction(options.traceBuilder, "budget.response.trim_lists", { field: "evidence", limit: minEvidenceItems });
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

  const trimEvidenceExcerptsFallback = () => {
    if (!Array.isArray(response.evidence)) return false;
    let changed = false;
    for (const item of response.evidence) {
      if (typeof item?.excerpt !== "string") continue;
      if (item.excerpt.length <= MIN_FALLBACK_EXCERPT_CHARS) continue;
      item.excerpt = truncate(item.excerpt, MIN_FALLBACK_EXCERPT_CHARS);
      item.truncated = true;
      changed = true;
    }
    if (changed) {
      recordBudgetAction(options.traceBuilder, "budget.response.trim_items", {
        field: "evidence",
        maxChars: MIN_FALLBACK_EXCERPT_CHARS
      });
    }
    return changed;
  };

  const dropEvidence = () => {
    if (!Array.isArray(response.evidence) || response.evidence.length === 0) return false;
    if (response.evidence.length <= minEvidenceItems) return false;
    removedItems += response.evidence.length - minEvidenceItems;
    response.evidence = response.evidence.slice(0, minEvidenceItems);
    recordBudgetAction(options.traceBuilder, "budget.response.trim_lists", { field: "evidence", limit: minEvidenceItems });
    return true;
  };
  const attachTruncationSummary = () => {
    response.truncationSummary = {
      removedItems,
      originalSize
    };
  };

  dropField("details");
  usage = estimateResponseUsage(response);
  if (withinBudget(usage, options)) {
    recordTrace(options.traceBuilder, usage, options, true);
    attachTruncationSummary();
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
    attachTruncationSummary();
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

  const excerptChars = Math.max(
    MIN_EVIDENCE_EXCERPT_CHARS,
    Number.isFinite(options.minExcerptChars) ? options.minExcerptChars! : MIN_PREVIEW_CHARS
  );
  if (trimEvidenceExcerpts(excerptChars)) {
    applied = true;
    usage = estimateResponseUsage(response);
  }
  if (withinBudget(usage, options)) {
    attachTruncationSummary();
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
    attachTruncationSummary();
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

  if (trimEvidenceExcerptsFallback()) {
    applied = true;
    usage = estimateResponseUsage(response);
  }
  if (withinBudget(usage, options)) {
    attachTruncationSummary();
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
    attachTruncationSummary();
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
