import { describe, it, expect, jest } from "@jest/globals";
import type { HandlerContext } from "../../../handlers/HandlerContext.js";
import { KairoSearchHandler } from "../../../handlers/kairo/KairoSearchHandler.js";
import { createDefaultToolSpecRegistry } from "../../../server/tools/ToolSpecRegistry.js";

const toolSpecRegistry = createDefaultToolSpecRegistry();

const makeContext = (overrides: Record<string, unknown> = {}): HandlerContext =>
  ({
    searchEngine: {
      scout: jest.fn(async () => []),
    },
    documentSearchEngine: {
      search: jest.fn(async () => ({ results: [] })),
    },
    toolSpecRegistry,
    ...overrides,
  }) as unknown as HandlerContext;

const parse = (response: any) => JSON.parse(response.content[0].text);

describe("KairoSearchHandler", () => {
  it("returns null for non-matching tool name", async () => {
    const handler = new KairoSearchHandler(makeContext());
    expect(await handler.handle("other_tool", {})).toBeNull();
  });

  it("returns MissingParameter for missing query", async () => {
    const handler = new KairoSearchHandler(makeContext());
    const response = await handler.handle("kairo_search", {});
    expect(response.isError).toBe(true);
    expect(parse(response).errorCode).toBe("MissingParameter");
  });

  it("returns results for valid query (code scope)", async () => {
    const ctx = makeContext({
      searchEngine: {
        scout: jest.fn(async () => [
          { filePath: "src/app.ts", lineNumber: 10, preview: "function auth()", score: 0.9 },
          { filePath: "src/login.ts", lineNumber: 5, preview: "const auth = true", score: 0.7 },
        ]),
      },
    });
    const handler = new KairoSearchHandler(ctx);
    const response = await handler.handle("kairo_search", { query: "auth" });
    expect(response.isError).toBeFalsy();
    const result = parse(response);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].file).toBe("src/app.ts");
    expect(result.results[0].score).toBe(0.9);
    expect(result.results[0].snippet).toContain("auth");
    expect(result.truncated).toBe(false);
  });

  it("respects limit parameter", async () => {
    const ctx = makeContext({
      searchEngine: {
        scout: jest.fn(async () => [
          { filePath: "a.ts", lineNumber: 1, preview: "a", score: 0.9 },
          { filePath: "b.ts", lineNumber: 1, preview: "b", score: 0.8 },
          { filePath: "c.ts", lineNumber: 1, preview: "c", score: 0.7 },
        ]),
      },
    });
    const handler = new KairoSearchHandler(ctx);
    const response = await handler.handle("kairo_search", { query: "test", limit: 2 });
    const result = parse(response);
    expect(result.results).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("queries document search when scope is docs", async () => {
    const docSearch = jest.fn(async () => ({
      results: [{ filePath: "README.md", preview: "about auth", score: 0.6 }],
    }));
    const ctx = makeContext({
      searchEngine: { scout: jest.fn(async () => []) },
      documentSearchEngine: { search: docSearch },
    });
    const handler = new KairoSearchHandler(ctx);
    const response = await handler.handle("kairo_search", { query: "auth", scope: "docs" });
    const result = parse(response);
    expect(docSearch).toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].file).toBe("README.md");
  });

  it("merges code + docs when scope is all", async () => {
    const ctx = makeContext({
      searchEngine: {
        scout: jest.fn(async () => [
          { filePath: "src/a.ts", lineNumber: 1, preview: "code hit", score: 0.9 },
        ]),
      },
      documentSearchEngine: {
        search: jest.fn(async () => ({
          results: [{ filePath: "docs/b.md", preview: "doc hit", score: 0.5 }],
        })),
      },
    });
    const handler = new KairoSearchHandler(ctx);
    const response = await handler.handle("kairo_search", { query: "hit", scope: "all" });
    const result = parse(response);
    expect(result.results).toHaveLength(2);
    // sorted by score descending
    expect(result.results[0].file).toBe("src/a.ts");
    expect(result.results[1].file).toBe("docs/b.md");
  });

  it("degrades gracefully when document search throws", async () => {
    const ctx = makeContext({
      searchEngine: {
        scout: jest.fn(async () => [
          { filePath: "src/a.ts", lineNumber: 1, preview: "hit", score: 0.8 },
        ]),
      },
      documentSearchEngine: {
        search: jest.fn(async () => {
          throw new Error("not available");
        }),
      },
    });
    const handler = new KairoSearchHandler(ctx);
    const response = await handler.handle("kairo_search", { query: "test", scope: "all" });
    expect(response.isError).toBeFalsy();
    const result = parse(response);
    expect(result.results).toHaveLength(1);
  });

  it("passes fileTypes and semanticSymbols to searchEngine", async () => {
    const scoutMock = jest.fn(async () => []);
    const ctx = makeContext({ searchEngine: { scout: scoutMock } });
    const handler = new KairoSearchHandler(ctx);
    await handler.handle("kairo_search", { query: "fn", fileTypes: ["ts", "js"] });
    expect(scoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "fn",
        fileTypes: ["ts", "js"],
        semanticSymbols: true,
      }),
    );
  });

  it("returns SearchError on engine failure", async () => {
    const ctx = makeContext({
      searchEngine: {
        scout: jest.fn(async () => {
          throw new Error("engine down");
        }),
      },
    });
    const handler = new KairoSearchHandler(ctx);
    const response = await handler.handle("kairo_search", { query: "test" });
    expect(response.isError).toBe(true);
    expect(parse(response).errorCode).toBe("SearchError");
  });

  it("has no legacy response fields (degradedReasons, guidance, nextCalls)", async () => {
    const ctx = makeContext({
      searchEngine: {
        scout: jest.fn(async () => [
          { filePath: "a.ts", lineNumber: 1, preview: "hit", score: 0.5 },
        ]),
      },
    });
    const handler = new KairoSearchHandler(ctx);
    const response = await handler.handle("kairo_search", { query: "test" });
    const result = parse(response);
    expect(result).not.toHaveProperty("degradedReasons");
    expect(result).not.toHaveProperty("guidance");
    expect(result).not.toHaveProperty("nextCalls");
    expect(result).not.toHaveProperty("contract");
    expect(result).not.toHaveProperty("sessionId");
  });
});
