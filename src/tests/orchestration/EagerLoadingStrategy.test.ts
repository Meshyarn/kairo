import { describe, it, expect } from "@jest/globals";
import { EagerLoadingStrategy } from "../../orchestration/EagerLoadingStrategy.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";

const makeContextWithSearch = () => {
  const context = new OrchestrationContext();
  context.addStep({
    id: "search",
    tool: "project_search",
    args: { query: "demo" },
    output: { results: [{ path: "src/demo.ts", symbol: { name: "demo" } }] },
    status: "success",
    duration: 1
  });
  return context;
};

describe("EagerLoadingStrategy", () => {
  it("loads hotspots, dependencies, and calls for understand", async () => {
    const registry = new InternalToolRegistry();
    const calls: string[] = [];
    registry.register("hotspot_detect", async () => {
      calls.push("hotspot_detect");
      return [] as any;
    });
    registry.register("relationship_analyze", async (args: any) => {
      calls.push(`relationship_analyze:${args.mode}`);
      return { nodes: [], edges: [] } as any;
    });

    const strategy = new EagerLoadingStrategy();
    const context = makeContextWithSearch();

    await strategy.execute({
      category: "understand",
      action: "analyze",
      targets: ["src/demo.ts"],
      originalIntent: "understand demo",
      constraints: { depth: "deep", include: { callGraph: true, dependencies: true } },
      confidence: 1
    } as any, context, registry);

    expect(calls).toEqual(expect.arrayContaining([
      "hotspot_detect",
      "relationship_analyze:dependencies",
      "relationship_analyze:calls"
    ]));
  });

  it("skips hotspot detector when include.hotSpots is false", async () => {
    const registry = new InternalToolRegistry();
    const calls: string[] = [];
    registry.register("hotspot_detect", async () => {
      calls.push("hotspot_detect");
      return [] as any;
    });
    registry.register("relationship_analyze", async (args: any) => {
      calls.push(`relationship_analyze:${args.mode}`);
      return { nodes: [], edges: [] } as any;
    });

    const strategy = new EagerLoadingStrategy();
    const context = makeContextWithSearch();

    await strategy.execute({
      category: "understand",
      action: "analyze",
      targets: ["src/demo.ts"],
      originalIntent: "understand demo",
      constraints: { depth: "shallow", include: { hotSpots: false, callGraph: false, dependencies: false } },
      confidence: 1
    } as any, context, registry);

    expect(calls).toHaveLength(0);
  });

  it("loads profile for navigate", async () => {
    const registry = new InternalToolRegistry();
    const calls: string[] = [];
    registry.register("file_profile", async () => {
      calls.push("file_profile");
      return { metadata: {} } as any;
    });

    const strategy = new EagerLoadingStrategy();
    const context = makeContextWithSearch();

    await strategy.execute({
      category: "navigate",
      action: "find",
      targets: ["src/demo.ts"],
      originalIntent: "find demo",
      constraints: {},
      confidence: 1
    } as any, context, registry);

    expect(calls).toEqual(["file_profile"]);
  });
});
