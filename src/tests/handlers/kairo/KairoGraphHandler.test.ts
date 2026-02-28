import { describe, it, expect, jest } from "@jest/globals";
import type { HandlerContext } from "../../../handlers/HandlerContext.js";
import { KairoGraphHandler } from "../../../handlers/kairo/KairoGraphHandler.js";
import { createDefaultToolSpecRegistry } from "../../../server/tools/ToolSpecRegistry.js";

const toolSpecRegistry = createDefaultToolSpecRegistry();

const makeContext = (overrides: Record<string, unknown> = {}): HandlerContext =>
  ({
    callGraphBuilder: {
      analyzeSymbol: jest.fn(async () => null),
    },
    dependencyGraph: {
      getEntryPoints: jest.fn(() => []),
    },
    hotSpotDetector: null,
    graphRagClusterService: null,
    toolSpecRegistry,
    ...overrides,
  }) as unknown as HandlerContext;

const parse = (response: any) => JSON.parse(response.content[0].text);

describe("KairoGraphHandler", () => {
  it("returns null for non-matching tool name", async () => {
    const handler = new KairoGraphHandler(makeContext());
    expect(await handler.handle("other_tool", {})).toBeNull();
  });

  it("returns empty graph when no focus and include=dependencies", async () => {
    const handler = new KairoGraphHandler(makeContext());
    const response = await handler.handle("kairo_graph", { include: ["dependencies"] });
    expect(response.isError).toBeFalsy();
    const result = parse(response);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("returns dependency graph for focus symbol", async () => {
    const ctx = makeContext({
      callGraphBuilder: {
        analyzeSymbol: jest.fn(async () => ({
          visitedNodes: {
            sym1: { symbolId: "sym1", symbolName: "Foo", filePath: "src/a.ts", symbolType: "class", callees: ["sym2"] },
            sym2: { symbolId: "sym2", symbolName: "Bar", filePath: "src/b.ts", symbolType: "function", callees: [] },
          },
        })),
      },
    });
    const handler = new KairoGraphHandler(ctx);
    const response = await handler.handle("kairo_graph", { focus: "Foo", include: ["dependencies"] });
    const result = parse(response);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].name).toBe("Foo");
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({ from: "sym1", to: "sym2", type: "calls" });
  });

  it("includes hotSpots when requested", async () => {
    const ctx = makeContext({
      hotSpotDetector: {
        detectHotSpots: jest.fn(async () => [
          { filePath: "src/hot.ts", symbol: { name: "HotFunc" }, score: 0.95, reasons: ["high complexity"] },
          { filePath: "src/warm.ts", symbol: { name: "WarmFunc" }, score: 0.7, reasons: ["many imports"] },
        ]),
      },
    });
    const handler = new KairoGraphHandler(ctx);
    const response = await handler.handle("kairo_graph", { include: ["hotSpots"] });
    const result = parse(response);
    expect(result.hotSpots).toHaveLength(2);
    expect(result.hotSpots[0].file).toBe("src/hot.ts");
    expect(result.hotSpots[0].symbol).toBe("HotFunc");
    expect(result.hotSpots[0].score).toBe(0.95);
  });

  it("includes entryPoints when requested", async () => {
    const ctx = makeContext({
      dependencyGraph: {
        getEntryPoints: jest.fn(() => [
          { filePath: "src/main.ts" },
          "src/index.ts",
        ]),
      },
    });
    const handler = new KairoGraphHandler(ctx);
    const response = await handler.handle("kairo_graph", { include: ["entryPoints"] });
    const result = parse(response);
    expect(result.entryPoints).toHaveLength(2);
    expect(result.entryPoints[0].file).toBe("src/main.ts");
    expect(result.entryPoints[1].file).toBe("src/index.ts");
  });

  it("includes clusters when requested", async () => {
    const ctx = makeContext({
      graphRagClusterService: {
        buildClusters: jest.fn(async () => ({
          clusters: [
            {
              clusterId: "c1",
              entryPoint: "main.ts",
              relevanceScore: 0.8,
              relationships: { dependency: { count: 3 }, colocated: { count: 2 } },
            },
          ],
        })),
      },
    });
    const handler = new KairoGraphHandler(ctx);
    const response = await handler.handle("kairo_graph", { focus: "main", include: ["clusters"] });
    const result = parse(response);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].id).toBe("c1");
    expect(result.clusters[0].fileCount).toBe(5);
  });

  it("returns empty hotSpots when hotSpotDetector is unavailable", async () => {
    const handler = new KairoGraphHandler(makeContext({ hotSpotDetector: null }));
    const response = await handler.handle("kairo_graph", { include: ["hotSpots"] });
    const result = parse(response);
    // hotSpots is not set when detector is null
    expect(result.hotSpots).toBeUndefined();
  });

  it("handles hotSpotDetector errors gracefully", async () => {
    const ctx = makeContext({
      hotSpotDetector: {
        detectHotSpots: jest.fn(async () => {
          throw new Error("detector error");
        }),
      },
    });
    const handler = new KairoGraphHandler(ctx);
    const response = await handler.handle("kairo_graph", { include: ["hotSpots"] });
    expect(response.isError).toBeFalsy();
    const result = parse(response);
    expect(result.hotSpots).toEqual([]);
  });

  it("returns GraphError on engine failure", async () => {
    const ctx = makeContext({
      callGraphBuilder: {
        analyzeSymbol: jest.fn(async () => {
          throw new Error("crash");
        }),
      },
    });
    const handler = new KairoGraphHandler(ctx);
    const response = await handler.handle("kairo_graph", { focus: "Foo", include: ["dependencies"] });
    expect(response.isError).toBe(true);
    expect(parse(response).errorCode).toBe("GraphError");
  });

  it("uses project-wide depth when scope=project", async () => {
    const analyzeSymbol = jest.fn(async () => ({ visitedNodes: {} }));
    const ctx = makeContext({ callGraphBuilder: { analyzeSymbol } });
    const handler = new KairoGraphHandler(ctx);
    await handler.handle("kairo_graph", { focus: "Foo", scope: "project", include: ["dependencies"] });
    expect(analyzeSymbol).toHaveBeenCalledWith("Foo", "", "both", 4);
  });

  it("has no legacy response fields", async () => {
    const handler = new KairoGraphHandler(makeContext());
    const response = await handler.handle("kairo_graph", { include: ["dependencies"] });
    const result = parse(response);
    expect(result).not.toHaveProperty("degradedReasons");
    expect(result).not.toHaveProperty("guidance");
    expect(result).not.toHaveProperty("nextCalls");
    expect(result).not.toHaveProperty("contract");
  });
});
