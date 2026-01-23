import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { estimateTokens } from "../TokenBudget.js";
import { buildDegradedReasons } from "../DegradedReasonMapper.js";
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

type TaskResponseBudgetOptions = EnvelopeBudgetOptions & {
  minEvidenceItems?: number;
  minExcerptChars?: number;
};

const DEFAULT_PREVIEW_CHARS = 800;
const MIN_PREVIEW_CHARS = 240;
const DEFAULT_ELASTIC_WINDOW_PCT = 0.05;
const DEFAULT_DIFF_CHARS = 2000;
const MIN_DIFF_CHARS = 800;

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
    ? usage.estimatedTokens > Math.ceil(options.maxTokens * (1 + DEFAULT_ELASTIC_WINDOW_PCT))
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

function recordBudgetAction(traceBuilder: TraceBuilder | undefined, code: string, data?: Record<string, unknown>) {
  if (!traceBuilder) return;
  traceBuilder.recordEvent({
    area: "budget",
    code,
    ...(data ? { data } : {})
  });
}

function markBudgetExceeded(response: { degraded?: boolean; reasons?: string[] }): void {
  response.degraded = true;
  response.reasons = Array.from(new Set([...(response.reasons ?? []), "budget_exceeded"]));
}

function markBudgetExceededWithReasons(response: { degraded?: boolean; degradedReasons?: any[] }): void {
  response.degraded = true;
  const existing = Array.isArray(response.degradedReasons) ? response.degradedReasons : [];
  if (existing.some((reason) => reason?.type === "budget_exceeded")) {
    response.degradedReasons = existing;
    return;
  }
  const additions = buildDegradedReasons(["budget_exceeded"]) ?? [];
  response.degradedReasons = [...existing, ...additions];
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

function truncateStringField(
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

function trimArrayField(
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

function compactDraftPack(pack: any): any {
  if (!pack || typeof pack !== "object") return pack;
  return {
    id: pack.id,
    intent: pack.intent,
    status: pack.status,
    createdAt: pack.createdAt,
    fileVersions: pack.fileVersions,
    preflightCheck: pack.preflightCheck,
    workflowMeta: pack.workflowMeta
  };
}

function compactReviewReport(report: any): any {
  if (!report || typeof report !== "object") return report;
  return {
    id: report.id,
    verdict: report.verdict,
    reviewedAt: report.reviewedAt,
    reviewedFiles: report.reviewedFiles,
    suggestedActions: Array.isArray(report.suggestedActions)
      ? report.suggestedActions.slice(0, 3)
      : undefined
  };
}

function compactImpactReport(report: any): any {
  if (!report || typeof report !== "object") return report;
  const preview = report.preview && typeof report.preview === "object"
    ? {
        summary: report.preview.summary,
        riskLevel: report.preview.riskLevel,
        impactedFiles: Array.isArray(report.preview.summary?.impactedFiles)
          ? report.preview.summary.impactedFiles.slice(0, 10)
          : undefined
      }
    : undefined;
  return {
    breakingChangeRisk: report.breakingChangeRisk,
    suggestedTests: Array.isArray(report.suggestedTests) ? report.suggestedTests.slice(0, 5) : undefined,
    preview
  };
}

function compactArtifact(artifact: any): any {
  if (!artifact || typeof artifact !== "object") return artifact;
  if (artifact.type === "draft" && artifact.pack) {
    return { ...artifact, pack: compactDraftPack(artifact.pack) };
  }
  if (artifact.type === "review" && artifact.report) {
    return { ...artifact, report: compactReviewReport(artifact.report) };
  }
  if (artifact.type === "analysis" && artifact.pack) {
    const pack = artifact.pack;
    return {
      ...artifact,
      pack: {
        id: pack.id,
        goal: pack.goal,
        clusters: Array.isArray(pack.clusters) ? pack.clusters.slice(0, 3) : [],
        createdAt: pack.createdAt,
        degraded: pack.degraded
      }
    };
  }
  if (artifact.type === "research" && artifact.pack) {
    const pack = artifact.pack;
    return {
      ...artifact,
      pack: {
        id: pack.id,
        createdAt: pack.createdAt,
        expiresAt: pack.expiresAt,
        sketch: pack.sketch
          ? {
              summary: pack.sketch.summary,
              topModules: Array.isArray(pack.sketch.topModules) ? pack.sketch.topModules.slice(0, 3) : [],
              edgesSample: Array.isArray(pack.sketch.edgesSample) ? pack.sketch.edgesSample.slice(0, 5) : []
            }
          : undefined
      }
    };
  }
  if (artifact.type === "style" && artifact.pack) {
    const pack = artifact.pack;
    return {
      ...artifact,
      pack: {
        id: pack.id,
        scope: pack.scope,
        createdAt: pack.createdAt,
        confidence: pack.confidence,
        profile: pack.profile ? { codeStyle: pack.profile.codeStyle } : undefined
      }
    };
  }
  return artifact;
}

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

export function enforceChangeResponseBudget(args: {
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

  if (!withinBudget(usage, options)) {
    applied = truncateStringField(response, "diff", DEFAULT_DIFF_CHARS, options.traceBuilder) || applied;
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options) && response.draftPack) {
    response.draftPack = compactDraftPack(response.draftPack);
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.compact_field", { field: "draftPack" });
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options) && response.review) {
    response.review = compactReviewReport(response.review);
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.compact_field", { field: "review" });
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options) && response.postReview) {
    response.postReview = compactReviewReport(response.postReview);
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.compact_field", { field: "postReview" });
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options) && response.impactReport) {
    response.impactReport = compactImpactReport(response.impactReport);
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.compact_field", { field: "impactReport" });
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options)) {
    applied = trimArrayField(response, "relatedDocs", 5, options.traceBuilder) || applied;
    usage = estimateResponseUsage(response);
  }

  if (!withinBudget(usage, options)) dropField("symbolImpact");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("suggestedEdits");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("editResult");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("formatter");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("integrity");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("plan");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) {
    applied = truncateStringField(response, "diff", MIN_DIFF_CHARS, options.traceBuilder) || applied;
    usage = estimateResponseUsage(response);
  }

  if (!withinBudget(usage, options)) {
    dropField("draftPack");
    dropField("review");
    dropField("postReview");
    dropField("impactReport");
    dropField("diff");
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

export function enforceWriteResponseBudget(args: {
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

  if (!withinBudget(usage, options) && response.draftPack) {
    response.draftPack = compactDraftPack(response.draftPack);
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.compact_field", { field: "draftPack" });
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options) && response.review) {
    response.review = compactReviewReport(response.review);
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.compact_field", { field: "review" });
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options) && response.postReview) {
    response.postReview = compactReviewReport(response.postReview);
    applied = true;
    recordBudgetAction(options.traceBuilder, "budget.response.compact_field", { field: "postReview" });
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options)) {
    applied = truncateStringField(response, "diff", DEFAULT_DIFF_CHARS, options.traceBuilder) || applied;
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options)) {
    dropField("editResult");
    usage = estimateResponseUsage(response);
  }
  if (!withinBudget(usage, options)) dropField("formatter");
  usage = estimateResponseUsage(response);
  if (!withinBudget(usage, options)) dropField("integrity");
  usage = estimateResponseUsage(response);

  if (!withinBudget(usage, options)) {
    dropField("draftPack");
    dropField("review");
    dropField("postReview");
    dropField("diff");
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
