import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { truncate, type ExploreResponse } from "../pillars/explore/ResultFormatter.js";
import { DEFAULT_ELASTIC_WINDOW_PCT, DEFAULT_PREVIEW_CHARS, MIN_PREVIEW_CHARS } from "./ResponseEnvelopeBudgeterConstants.js";
import type { EnvelopeBudgetOptions, EnvelopeBudgetResult } from "./ResponseEnvelopeBudgeterTypes.js";
import { estimateResponseUsage, markBudgetExceeded, recordBudgetAction, recordTrace, withinBudget } from "./ResponseEnvelopeBudgeterUtils.js";

function trimExploreItems(items: ExploreResponse["data"]["docs"], options: { removeContent?: boolean; previewChars?: number }): boolean {
  let changed = false;
  const previewChars = options.previewChars ?? DEFAULT_PREVIEW_CHARS;
  for (const item of items) {
    if (options.removeContent && item.content) {
      item.content = undefined;
      changed = true;
    }
    if (item.preview && item.preview.length > previewChars) {
      item.preview = truncate(item.preview, previewChars);
      changed = true;
    }
  }
  return changed;
}

function shrinkExploreLists(response: ExploreResponse, minCounts: { docs: number; code: number }): boolean {
  const docs = response.data.docs;
  const code = response.data.code;
  if (docs.length <= minCounts.docs && code.length <= minCounts.code) return false;

  if (code.length > minCounts.code && (code.length >= docs.length || docs.length <= minCounts.docs)) {
    code.pop();
    return true;
  }
  if (docs.length > minCounts.docs) {
    docs.pop();
    return true;
  }
  if (code.length > minCounts.code) {
    code.pop();
    return true;
  }
  return false;
}

export function enforceExploreResponseBudget(args: {
  response: ExploreResponse;
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

  const originalCounts = { docs: response.data.docs.length, code: response.data.code.length };
  const minCounts = {
    docs: originalCounts.docs > 0 ? 1 : 0,
    code: originalCounts.code > 0 ? 1 : 0
  };
  let applied = false;

  const dropField = (key: keyof ExploreResponse) => {
    if (response[key] !== undefined) {
      (response as any)[key] = undefined;
      applied = true;
      recordBudgetAction(options.traceBuilder, "budget.response.drop_field", { field: key });
    }
  };

  dropField("researchPack");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("integrity");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("indexSnapshot");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("insights");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("clusters");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("clusterPolicy");

  if (!withinBudget(usage, options)) {
    const before = { docs: response.data.docs.length, code: response.data.code.length };
    applied = trimExploreItems(response.data.docs, { removeContent: true, previewChars: DEFAULT_PREVIEW_CHARS }) || applied;
    applied = trimExploreItems(response.data.code, { removeContent: true, previewChars: DEFAULT_PREVIEW_CHARS }) || applied;
    recordBudgetAction(options.traceBuilder, "budget.response.trim_items", { step: "remove_content", previewChars: DEFAULT_PREVIEW_CHARS, ...before });
    usage = estimateResponseUsage(response);
  }

  if (!withinBudget(usage, options)) {
    const before = { docs: response.data.docs.length, code: response.data.code.length };
    applied = trimExploreItems(response.data.docs, { removeContent: true, previewChars: MIN_PREVIEW_CHARS }) || applied;
    applied = trimExploreItems(response.data.code, { removeContent: true, previewChars: MIN_PREVIEW_CHARS }) || applied;
    recordBudgetAction(options.traceBuilder, "budget.response.trim_items", { step: "shrink_preview", previewChars: MIN_PREVIEW_CHARS, ...before });
    usage = estimateResponseUsage(response);
  }

  let guard = 0;
  while (!withinBudget(usage, options) && guard < 50) {
    if (!shrinkExploreLists(response, minCounts)) break;
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.shrink_lists", { returnedDocs: response.data.docs.length, returnedCode: response.data.code.length });
    usage = estimateResponseUsage(response);
    guard += 1;
  }

  if (!withinBudget(usage, options) && (response.data.docs.length > minCounts.docs || response.data.code.length > minCounts.code)) {
    response.data.docs = [];
    response.data.code = [];
    applied = true;
    usage = estimateResponseUsage(response);
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
      },
      itemsTruncated: true,
      totalDocs: originalCounts.docs,
      totalCode: originalCounts.code,
      returnedDocs: response.data.docs.length,
      returnedCode: response.data.code.length
    };
    recordTrace(options.traceBuilder, usage, options, true);
  } else {
    recordTrace(options.traceBuilder, usage, options, false);
  }

  return { applied, estimatedTokens: usage.estimatedTokens, usedChars: usage.usedChars };
}
