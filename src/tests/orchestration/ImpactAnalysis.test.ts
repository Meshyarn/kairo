import { describe, it, expect } from "@jest/globals";
import {
  analyzeSymbolImpact,
  collectDependentsFromGraph,
  computePageRankDelta,
  computePageRankFromEdges,
  toImpactReport
} from "../../orchestration/pillars/change/ImpactAnalysis.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";

const edges = [
  { from: "a.ts", to: "b.ts" },
  { from: "b.ts", to: "c.ts" },
  { from: "c.ts", to: "a.ts" }
];

describe("ImpactAnalysis", () => {
  it("computes page rank from edges", () => {
    const ranks = computePageRankFromEdges(edges);
    expect(ranks.size).toBe(3);
    expect(Array.from(ranks.values()).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 3);
  });

  it("computes page rank delta for impacted files", () => {
    const delta = computePageRankDelta({ edges }, ["a.ts", "b.ts"]);
    expect(delta.has("a.ts")).toBe(true);
    expect(delta.has("b.ts")).toBe(true);
  });

  it("builds impact report with hot spots", () => {
    const impact = {
      riskLevel: "high",
      suggestedTests: ["test-a"],
      summary: { impactedFiles: ["b.ts"] }
    };
    const hotSpots = [{ filePath: "b.ts", score: 0.9 }];
    const report = toImpactReport(impact, { edges }, "a.ts", hotSpots);

    expect(report?.breakingChangeRisk).toBe("high");
    expect(report?.affectedHotSpots).toHaveLength(1);
    expect(report?.testPriority.get("test-a")).toBe("important");
  });

  it("collects dependents from UCG graph", async () => {
    const node = { dependents: new Set(["dep.ts"]), topology: { topLevelSymbols: [{ name: "Foo" }] }, lod: 1 };
    const depNode = { topology: { topLevelSymbols: [{ name: "Bar" }] }, lod: 1 };
    const ucg = {
      ensureLOD: async () => {},
      getNode: (path: string) => (path === "main.ts" ? node : path === "dep.ts" ? depNode : undefined)
    };

    const ctx = new OrchestrationContext();
    const result = await collectDependentsFromGraph(ucg as any, "main.ts", ctx);

    expect(result?.success).toBe(true);
    expect(result?.edges[0].from).toBe("dep.ts");
  });

  it("returns null when symbol impact analysis fails", async () => {
    const result = await analyzeSymbolImpact("missing.ts", [], {}, { readFile: async () => { throw new Error("fail"); } } as any);
    expect(result).toBeNull();
  });
});
