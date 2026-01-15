import { applyTokenBudget, estimateTokens } from "../../TokenBudget.js";
import type { ExploreItem } from "./ResultFormatter.js";
import { truncate } from "./ResultFormatter.js";
import { metrics } from "../../../utils/MetricsCollector.js";

export type ExploreCompressionDecision = {
  item: string;
  from: "full" | "skeleton" | "reference" | "summary";
  to: "full" | "skeleton" | "reference" | "summary";
  reason: "budget_exceeded" | "low_score" | "distance";
};

export type ExploreBudgetState = {
  budgetExceeded: boolean;
  compressionEstimatedTokens: number;
  compressionUsedChars: number;
  compressionDecisions: ExploreCompressionDecision[];
};

export function createExploreBudgetState(): ExploreBudgetState {
  return {
    budgetExceeded: false,
    compressionEstimatedTokens: 0,
    compressionUsedChars: 0,
    compressionDecisions: []
  };
}

export function applyBudgetToExploreItem(
  state: ExploreBudgetState,
  item: ExploreItem,
  args: {
    isFullContent: boolean;
    allowDistill: boolean;
    maxItemTokens?: number;
    maxChars: number;
    maxItemChars: number;
    getLanguageId?: (filePath: string) => string | undefined;
    applyTokenBudget?: typeof applyTokenBudget;
    truncate?: typeof truncate;
  }
): ExploreItem {
  const stopTimer = metrics.startTimer("decision.explore_item_budget_ms", "detailed");
  try {
  const text = args.isFullContent ? item.content : item.preview;
  if (!text) return item;

  const apply = args.applyTokenBudget ?? applyTokenBudget;
  const doTruncate = args.truncate ?? truncate;
  const languageId = args.getLanguageId?.(item.filePath);

  const budget = apply(text, {
    maxTokens: args.maxItemTokens,
    maxChars: args.isFullContent ? args.maxChars : args.maxItemChars,
    languageId
  });

  state.compressionEstimatedTokens += budget.estimatedTokens ?? 0;
  state.compressionUsedChars += budget.usedChars;
  if (budget.applied) {
    state.budgetExceeded = true;
  }

  if (args.isFullContent && args.allowDistill && budget.applied) {
    item.preview = doTruncate(budget.text, args.maxItemChars);
    item.content = undefined;
    state.compressionDecisions.push({
      item: item.filePath,
      from: "full",
      to: "skeleton",
      reason: "budget_exceeded"
    });
  } else if (args.isFullContent) {
    item.content = budget.text;
  } else {
    item.preview = budget.text;
  }

  return item;
  } finally {
    stopTimer();
  }
}

export function applyBudgetToExploreItemsWithGlobalLimit(args: {
  state: ExploreBudgetState;
  items: ExploreItem[];
  isFullContent: boolean;
  allowDistill: boolean;
  maxItemTokens?: number;
  maxChars: number;
  maxItemChars: number;
  maxTokens?: number;
  totalTokens: number;
  degraded: boolean;
  reasons: string[];
  getLanguageId?: (filePath: string) => string | undefined;
  estimateTokens?: typeof estimateTokens;
}): { items: ExploreItem[]; totalTokens: number; degraded: boolean } {
  const stopTimer = metrics.startTimer("decision.explore_budget_global_ms", "detailed");
  try {
  const results: ExploreItem[] = [];
  const estimate = args.estimateTokens ?? estimateTokens;

  for (const item of args.items) {
    if (args.degraded && args.reasons.includes("budget_exceeded")) break;

    const processed = applyBudgetToExploreItem(args.state, item, {
      isFullContent: args.isFullContent,
      allowDistill: args.allowDistill,
      maxItemTokens: args.maxItemTokens,
      maxChars: args.maxChars,
      maxItemChars: args.maxItemChars,
      getLanguageId: args.getLanguageId
    });

    if (args.maxTokens) {
      const content = processed.content ?? processed.preview ?? "";
      const itemTokens = estimate(content, { languageId: args.getLanguageId?.(processed.filePath) });
      if (args.totalTokens + itemTokens > args.maxTokens) {
        args.degraded = true;
        args.reasons.push("budget_exceeded");
        break;
      }
      args.totalTokens += itemTokens;
    }

    results.push(processed);
  }

  return { items: results, totalTokens: args.totalTokens, degraded: args.degraded };
  } finally {
    stopTimer();
  }
}
