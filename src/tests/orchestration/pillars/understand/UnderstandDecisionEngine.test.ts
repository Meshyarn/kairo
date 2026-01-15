import { describe, expect, it } from "@jest/globals";
import {
  applySkeletonCompressionDecision,
  resolveAllowGraphs,
  shouldBuildFallbackGraph
} from "../../../../orchestration/pillars/understand/UnderstandDecisionEngine.js";

describe("UnderstandDecisionEngine", () => {
  it("resolves allowGraphs based on document/strength/budget/include flags", () => {
    expect(resolveAllowGraphs({
      isDocument: true,
      strongQuery: true,
      budgetProfile: "deep",
      includeCalls: true,
      includeDependencies: true,
      includeHotSpots: true
    })).toBe(false);

    expect(resolveAllowGraphs({
      isDocument: false,
      strongQuery: false,
      budgetProfile: "deep",
      includeCalls: true,
      includeDependencies: true,
      includeHotSpots: true
    })).toBe(false);

    expect(resolveAllowGraphs({
      isDocument: false,
      strongQuery: true,
      budgetProfile: "safe",
      includeCalls: false,
      includeDependencies: false,
      includeHotSpots: false
    })).toBe(false);

    expect(resolveAllowGraphs({
      isDocument: false,
      strongQuery: true,
      budgetProfile: "safe",
      includeCalls: true,
      includeDependencies: false,
      includeHotSpots: false
    })).toBe(true);
  });

  it("builds fallback graph for degraded L3 reasons", () => {
    expect(shouldBuildFallbackGraph(["missing_query_pack"])).toBe(true);
    expect(shouldBuildFallbackGraph(["budget_exceeded"])).toBe(false);
  });

  it("distills skeleton to digest when budget applied and digest available", () => {
    const result = applySkeletonCompressionDecision({
      skeleton: "SKELETON",
      filePath: "src/app.ts",
      maxTokens: 10,
      languageId: "typescript",
      buildDigest: () => "DIGEST",
      applyTokenBudget: (text: string) => ({
        text,
        applied: true,
        usedChars: text.length,
        estimatedTokens: 99
      }) as any
    });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("budget_exceeded");
    expect(result.skeleton).toBe("DIGEST");
    expect(result.compression?.mode).toBe("distill");
    expect(result.compression?.decisions).toEqual([
      { item: "src/app.ts", from: "skeleton", to: "summary", reason: "budget_exceeded" }
    ]);
  });
});

