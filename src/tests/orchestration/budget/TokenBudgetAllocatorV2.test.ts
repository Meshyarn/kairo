import { describe, it, expect } from "@jest/globals";
import { buildBudgetPlan } from "../../../orchestration/budget/TokenBudgetAllocatorV2.js";

describe("TokenBudgetAllocatorV2", () => {
  it("is deterministic for identical input", () => {
    const input = {
      pillar: "explore" as const,
      profile: "balanced" as const,
      maxTokens: 2000,
      maxChars: 8000,
      include: { docs: true, code: true },
      view: "auto" as const
    };
    const first = buildBudgetPlan(input);
    const second = buildBudgetPlan(input);
    expect(first).toEqual(second);
  });

  it("omits doc sections when docs are disabled", () => {
    const plan = buildBudgetPlan({
      pillar: "explore",
      profile: "fast",
      maxTokens: 1200,
      include: { docs: false }
    });
    const docSection = plan.sections.find((entry) => entry.section === "doc_sections");
    expect(docSection?.strategy).toBe("omit");
  });

  it("omits graphs on small budgets for understand", () => {
    const plan = buildBudgetPlan({
      pillar: "understand",
      profile: "fast",
      maxTokens: 800
    });
    const deps = plan.sections.find((entry) => entry.section === "dependencies");
    const calls = plan.sections.find((entry) => entry.section === "call_graph");
    expect(deps?.strategy).toBe("omit");
    expect(calls?.strategy).toBe("omit");
  });
});
