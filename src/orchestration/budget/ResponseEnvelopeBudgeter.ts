import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { estimateTokens } from "../TokenBudget.js";
import { truncate, type ExploreResponse } from "../pillars/explore/ResultFormatter.js";

type EnvelopeBudgetOptions = {
  maxTokens?: number;
  maxChars?: number;
  traceBuilder?: TraceBuilder;
};

type EnvelopeBudgetResult = {
  applied: boolean;
  estimatedTokens: number;
  usedChars: number;
};

const DEFAULT_PREVIEW_CHARS = 800;
const MIN_PREVIEW_CHARS = 240;

function estimateResponseUsage(response: unknown): { estimatedTokens: number; usedChars: number; serialized: string } {
  const serialized = JSON.stringify(response ?? {});
  return {
    serialized,
    usedChars: serialized.length,
    estimatedTokens: estimateTokens(serialized, { languageId: "json" })
  };
}

function withinBudget(usage: { estimatedTokens: number; usedChars: number }, options: EnvelopeBudgetOptions): boolean {
  const overTokens = typeof options.maxTokens === "number" && options.maxTokens > 0
    ? usage.estimatedTokens > options.maxTokens
    : false;
  const overChars = typeof options.maxChars === "number" && options.maxChars > 0
    ? usage.usedChars > options.maxChars
    : false;
  return !overTokens && !overChars;
}

function recordTrace(traceBuilder: TraceBuilder | undefined, usage: { estimatedTokens: number; usedChars: number }, options: EnvelopeBudgetOptions, applied: boolean) {
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

function markBudgetExceeded(response: { degraded?: boolean; reasons?: string[] }): void {
  response.degraded = true;
  response.reasons = Array.from(new Set([...(response.reasons ?? []), "budget_exceeded"]));
}

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
    }
  };

  dropField("researchPack");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("integrity");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("indexSnapshot");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("insights");

  if (!withinBudget(usage, options)) {
    applied = trimExploreItems(response.data.docs, { removeContent: true, previewChars: DEFAULT_PREVIEW_CHARS }) || applied;
    applied = trimExploreItems(response.data.code, { removeContent: true, previewChars: DEFAULT_PREVIEW_CHARS }) || applied;
    usage = estimateResponseUsage(response);
  }

  if (!withinBudget(usage, options)) {
    applied = trimExploreItems(response.data.docs, { removeContent: true, previewChars: MIN_PREVIEW_CHARS }) || applied;
    applied = trimExploreItems(response.data.code, { removeContent: true, previewChars: MIN_PREVIEW_CHARS }) || applied;
    usage = estimateResponseUsage(response);
  }

  let guard = 0;
  while (!withinBudget(usage, options) && guard < 50) {
    if (!shrinkExploreLists(response, minCounts)) break;
    applied = true;
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
    }
  };

  if (response.relationships?.calls) {
    response.relationships.calls = undefined;
    applied = true;
  }
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("analysisPack");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("stylePack");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("integrity");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("indexSnapshot");

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
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options)) {
    trimList("symbols", 50);
    trimList("hotSpots", 10);
    usage = estimateResponseUsage(response);
  }

  if (!withinBudget(usage, options) && response.document?.relatedCode) {
    const related = response.document.relatedCode;
    if (Array.isArray(related) && related.length > 5) {
      response.document.relatedCode = related.slice(0, 5);
      applied = true;
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
