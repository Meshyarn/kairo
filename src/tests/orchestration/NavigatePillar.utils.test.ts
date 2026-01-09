import { describe, it, expect, jest } from "@jest/globals";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { NavigatePillar } from "../../orchestration/pillars/NavigatePillar.js";

describe("NavigatePillar helpers", () => {
  it("computes page rank from edges", () => {
    const registry = new InternalToolRegistry();
    const pillar = new NavigatePillar(registry);

    const scores = (pillar as any).computePageRankFromEdges([
      { from: "a.ts", to: "b.ts" },
      { from: "b.ts", to: "c.ts" },
      { from: "c.ts", to: "a.ts" }
    ]);

    expect(scores.size).toBe(3);
  });

  it("resolves document paths via search when needed", async () => {
    const registry = new InternalToolRegistry();
    const pillar = new NavigatePillar(registry);
    const context = new OrchestrationContext();
    const runTool = jest.fn(async () => ({
      results: [{ path: "docs/guide.md" }]
    }));
    (pillar as any).runTool = runTool as any;

    const docPath = await (pillar as any).resolveDocPath(context, "guide", undefined);

    expect(docPath).toBe("docs/guide.md");
  });

  it("applies context filters for definitions/usages/tests/docs", async () => {
    const registry = new InternalToolRegistry();
    const pillar = new NavigatePillar(registry);
    const context = new OrchestrationContext();

    const filterRunTool = jest.fn().mockImplementation(async (...callArgs: any[]) => {
      const tool = callArgs[1];
      const args = callArgs[2];
      if (tool === "project_search") {
        if (Array.isArray(args?.includeGlobs) && args.includeGlobs.some((glob: string) => glob.includes(".md"))) {
          return { results: [{ path: "docs/guide.md" }] };
        }
        if (Array.isArray(args?.includeGlobs) && args.includeGlobs.some((glob: string) => glob.includes(".test"))) {
          return { results: [{ path: "tests/main.test.ts" }] };
        }
        return { results: [{ path: "src/main.ts", symbol: { name: "foo", type: "function" } }] };
      }
      if (tool === "reference_find") {
        return { references: [{ filePath: "src/use.ts", snippet: "foo()", line: 2 }] };
      }
      return { results: [{ path: "tests/main.test.ts" }] };
    });
    (pillar as any).runTool = filterRunTool as any;

    const defs = await (pillar as any).applyContextFilter(
      context,
      "main",
      "definitions",
      [
        { path: "src/main.ts", symbol: { type: "import" } },
        { path: "src/helper.ts", symbol: { type: "function" } }
      ],
      5
    );
    expect(defs).toHaveLength(1);

    const usages = await (pillar as any).applyContextFilter(
      context,
      "main",
      "usages",
      [{ path: "src/main.ts" }],
      5
    );
    expect(usages[0].type).toBe("usage");

    const tests = await (pillar as any).applyContextFilter(
      context,
      "main",
      "tests",
      [{ path: "src/main.ts" }],
      5
    );
    expect(tests[0].path).toBe("tests/main.test.ts");

    const docs = await (pillar as any).applyContextFilter(
      context,
      "main",
      "docs",
      [{ path: "src/main.ts" }],
      5
    );
    expect(docs[0].path).toBe("docs/guide.md");
  });

  it("loads hot spots, page rank, and related symbols", async () => {
    const registry = new InternalToolRegistry();
    const pillar = new NavigatePillar(registry);
    const context = new OrchestrationContext();

    const enrichRunTool = jest.fn().mockImplementation(async (_ctx, tool) => {
      if (tool === "hotspot_detect") {
        return [{ filePath: "src/main.ts" }];
      }
      if (tool === "relationship_analyze") {
        return { edges: [{ from: "src/main.ts", to: "src/other.ts" }] };
      }
      if (tool === "project_search") {
        return { results: [{ symbol: { name: "Foo", type: "function" }, path: "src/main.ts" }] };
      }
      return {};
    });
    (pillar as any).runTool = enrichRunTool as any;

    const hotSpots = await (pillar as any).loadHotSpotSet(context, [{ path: "src/main.ts" }]);
    expect(hotSpots.has("src/main.ts")).toBe(true);

    const pageRank = await (pillar as any).loadPageRankScores(context, [{ path: "src/main.ts" }]);
    expect(pageRank.size).toBeGreaterThan(0);

    const related = await (pillar as any).loadRelatedSymbols(context, "Foo");
    expect(related).toContain("Foo");
  });
});
