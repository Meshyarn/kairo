import type { TraceBuilder } from "../trace/TraceBuilder.js";

export type EnvelopeBudgetOptions = {
  maxTokens?: number;
  maxChars?: number;
  traceBuilder?: TraceBuilder;
};

export type EnvelopeBudgetResult = {
  applied: boolean;
  estimatedTokens: number;
  usedChars: number;
};

export type TaskResponseBudgetOptions = EnvelopeBudgetOptions & {
  minEvidenceItems?: number;
  minExcerptChars?: number;
};
