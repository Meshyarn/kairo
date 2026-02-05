import type { TraceBuilder } from "../trace/TraceBuilder.js";
import { DEFAULT_DIFF_CHARS, DEFAULT_ELASTIC_WINDOW_PCT } from "./ResponseEnvelopeBudgeterConstants.js";
import type { EnvelopeBudgetOptions, EnvelopeBudgetResult } from "./ResponseEnvelopeBudgeterTypes.js";
import { compactDraftPack, compactReviewReport } from "./ResponseEnvelopeBudgeterCompaction.js";
import {
  estimateResponseUsage,
  markBudgetExceededWithReasons,
  recordBudgetAction,
  recordTrace,
  truncateStringField,
  withinBudget
} from "./ResponseEnvelopeBudgeterUtils.js";

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
