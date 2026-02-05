import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { DEFAULT_DIFF_CHARS, DEFAULT_ELASTIC_WINDOW_PCT, MIN_DIFF_CHARS } from "./ResponseEnvelopeBudgeterConstants.js";
import type { EnvelopeBudgetOptions, EnvelopeBudgetResult } from "./ResponseEnvelopeBudgeterTypes.js";
import { compactDraftPack, compactImpactReport, compactReviewReport } from "./ResponseEnvelopeBudgeterCompaction.js";
import {
  estimateResponseUsage,
  markBudgetExceededWithReasons,
  recordBudgetAction,
  recordTrace,
  trimArrayField,
  truncateStringField,
  withinBudget
} from "./ResponseEnvelopeBudgeterUtils.js";

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
