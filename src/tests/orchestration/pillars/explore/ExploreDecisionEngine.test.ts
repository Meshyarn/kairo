import { describe, expect, it } from "@jest/globals";
import {
  applyBudgetToExploreItem,
  createExploreBudgetState
} from "../../../../orchestration/pillars/explore/ExploreDecisionEngine.js";

describe("ExploreDecisionEngine", () => {
  it("distills full content into preview when allowDistill and budget applied", () => {
    const state = createExploreBudgetState();
    const item: any = { filePath: "src/app.ts", content: "FULL", preview: "PREVIEW" };

    const updated = applyBudgetToExploreItem(state, item, {
      isFullContent: true,
      allowDistill: true,
      maxItemTokens: 10,
      maxChars: 100,
      maxItemChars: 3,
      getLanguageId: () => "typescript",
      applyTokenBudget: (text: string) => ({
        text,
        applied: true,
        usedChars: text.length,
        estimatedTokens: 42
      }) as any,
      truncate: (text: string, maxChars: number) => text.slice(0, maxChars)
    });

    expect(updated.content).toBeUndefined();
    expect(updated.preview).toBe("FUL");
    expect(state.budgetExceeded).toBe(true);
    expect(state.compressionDecisions).toEqual([
      { item: "src/app.ts", from: "full", to: "skeleton", reason: "budget_exceeded" }
    ]);
  });
});

