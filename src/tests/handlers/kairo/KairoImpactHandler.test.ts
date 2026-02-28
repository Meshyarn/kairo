import { describe, it, expect, jest } from "@jest/globals";
import type { HandlerContext } from "../../../handlers/HandlerContext.js";
import { KairoImpactHandler } from "../../../handlers/kairo/KairoImpactHandler.js";
import { createDefaultToolSpecRegistry } from "../../../server/tools/ToolSpecRegistry.js";

const toolSpecRegistry = createDefaultToolSpecRegistry();

const makeContext = (overrides: Record<string, unknown> = {}): HandlerContext =>
  ({
    impactAnalyzer: {
      analyzeImpact: jest.fn(async () => ({ affectedFiles: [] })),
    },
    callGraphBuilder: {
      analyzeSymbol: jest.fn(async () => null),
    },
    toolSpecRegistry,
    ...overrides,
  }) as unknown as HandlerContext;

const parse = (response: any) => JSON.parse(response.content[0].text);

describe("KairoImpactHandler", () => {
  it("returns null for non-matching tool name", async () => {
    const handler = new KairoImpactHandler(makeContext());
    expect(await handler.handle("other_tool", {})).toBeNull();
  });

  it("returns MissingParameter for missing target", async () => {
    const handler = new KairoImpactHandler(makeContext());
    const response = await handler.handle("kairo_impact", {});
    expect(response.isError).toBe(true);
    expect(parse(response).errorCode).toBe("MissingParameter");
  });

  it("analyzes file-based impact when target contains /", async () => {
    const analyzeImpact = jest.fn(async () => ({
      filePath: "src/engine/Search.ts",
      affectedFiles: [
        { filePath: "src/server/Handler.ts", depth: 1, isDirect: true, symbol: "SearchHandler" },
        { filePath: "src/tests/Search.test.ts", depth: 2, reason: "indirect import" },
      ],
    }));
    const ctx = makeContext({ impactAnalyzer: { analyzeImpact } });
    const handler = new KairoImpactHandler(ctx);
    const response = await handler.handle("kairo_impact", { target: "src/engine/Search.ts" });
    expect(response.isError).toBeFalsy();
    const result = parse(response);
    expect(result.riskLevel).toMatch(/low|medium|high|unknown/);
    expect(result.directRefs).toBeDefined();
    expect(analyzeImpact).toHaveBeenCalledWith("src/engine/Search.ts", []);
  });

  it("analyzes symbol-based impact when target is a symbol name", async () => {
    const analyzeSymbol = jest.fn(async () => ({
      visitedNodes: {
        node1: { filePath: "src/a.ts", symbolName: "Foo", depth: 1, symbolType: "class", lineNumber: 10, callees: [] },
        node2: { filePath: "src/b.ts", symbolName: "Bar", depth: 2, symbolType: "function", lineNumber: 20, callees: [] },
      },
    }));
    const ctx = makeContext({ callGraphBuilder: { analyzeSymbol } });
    const handler = new KairoImpactHandler(ctx);
    const response = await handler.handle("kairo_impact", { target: "SearchEngine" });
    expect(response.isError).toBeFalsy();
    const result = parse(response);
    expect(result.target).toBe("SearchEngine");
    expect(result.directRefs).toHaveLength(1);
    expect(result.directRefs[0].symbol).toBe("Foo");
    expect(result.transitiveImpact).toHaveLength(1);
    expect(result.transitiveImpact[0].depth).toBe(2);
  });

  it("returns unknown risk for non-existent symbol", async () => {
    const ctx = makeContext({
      callGraphBuilder: { analyzeSymbol: jest.fn(async () => null) },
    });
    const handler = new KairoImpactHandler(ctx);
    const response = await handler.handle("kairo_impact", { target: "NonExistentSymbol" });
    const result = parse(response);
    expect(result.riskLevel).toBe("unknown");
    expect(result.directRefs).toEqual([]);
    expect(result.transitiveImpact).toEqual([]);
  });

  it("uses shallow depth (2) by default", async () => {
    const analyzeSymbol = jest.fn(async () => null);
    const ctx = makeContext({ callGraphBuilder: { analyzeSymbol } });
    const handler = new KairoImpactHandler(ctx);
    await handler.handle("kairo_impact", { target: "Foo" });
    expect(analyzeSymbol).toHaveBeenCalledWith("Foo", "", "both", 2);
  });

  it("uses deep depth (5) when depth=deep", async () => {
    const analyzeSymbol = jest.fn(async () => null);
    const ctx = makeContext({ callGraphBuilder: { analyzeSymbol } });
    const handler = new KairoImpactHandler(ctx);
    await handler.handle("kairo_impact", { target: "Foo", depth: "deep" });
    expect(analyzeSymbol).toHaveBeenCalledWith("Foo", "", "both", 5);
  });

  it("excludes test files when includeTests is false (default)", async () => {
    const analyzeSymbol = jest.fn(async () => ({
      visitedNodes: {
        n1: { filePath: "src/a.ts", symbolName: "A", depth: 1, lineNumber: 1, callees: [] },
        n2: { filePath: "src/a.test.ts", symbolName: "ATest", depth: 1, lineNumber: 1, callees: [] },
      },
    }));
    const ctx = makeContext({ callGraphBuilder: { analyzeSymbol } });
    const handler = new KairoImpactHandler(ctx);
    const response = await handler.handle("kairo_impact", { target: "A" });
    const result = parse(response);
    expect(result.directRefs).toHaveLength(1);
    expect(result.directRefs[0].symbol).toBe("A");
  });

  it("calculates risk levels correctly", async () => {
    // medium: 4-10 total refs
    const analyzeSymbol = jest.fn(async () => ({
      visitedNodes: Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          `n${i}`,
          { filePath: `src/${i}.ts`, symbolName: `S${i}`, depth: 1, lineNumber: i, callees: [] },
        ]),
      ),
    }));
    const ctx = makeContext({ callGraphBuilder: { analyzeSymbol } });
    const handler = new KairoImpactHandler(ctx);
    const response = await handler.handle("kairo_impact", { target: "Big" });
    const result = parse(response);
    expect(result.riskLevel).toBe("medium");
  });

  it("returns ImpactAnalysisError on engine failure", async () => {
    const ctx = makeContext({
      callGraphBuilder: {
        analyzeSymbol: jest.fn(async () => {
          throw new Error("crash");
        }),
      },
    });
    const handler = new KairoImpactHandler(ctx);
    const response = await handler.handle("kairo_impact", { target: "Foo" });
    expect(response.isError).toBe(true);
    expect(parse(response).errorCode).toBe("ImpactAnalysisError");
  });

  it("has no legacy response fields", async () => {
    const ctx = makeContext();
    const handler = new KairoImpactHandler(ctx);
    const response = await handler.handle("kairo_impact", { target: "Foo" });
    const result = parse(response);
    expect(result).not.toHaveProperty("degradedReasons");
    expect(result).not.toHaveProperty("guidance");
    expect(result).not.toHaveProperty("nextCalls");
    expect(result).not.toHaveProperty("contract");
  });
});
