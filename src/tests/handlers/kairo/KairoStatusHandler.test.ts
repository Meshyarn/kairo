import { describe, it, expect, jest } from "@jest/globals";
import type { HandlerContext } from "../../../handlers/HandlerContext.js";
import { KairoStatusHandler } from "../../../handlers/kairo/KairoStatusHandler.js";
import { createDefaultToolSpecRegistry } from "../../../server/tools/ToolSpecRegistry.js";

const toolSpecRegistry = createDefaultToolSpecRegistry();

const makeContext = (overrides: Record<string, unknown> = {}): HandlerContext =>
  ({
    searchEngine: {
      getNativeStatus: jest.fn(() => ({
        available: true,
        stats: { docCount: 100 },
        error: null,
      })),
      isIndexReady: jest.fn(() => true),
    },
    symbolIndex: {
      getStats: jest.fn(() => ({ symbolCount: 50 })),
    },
    dependencyGraph: {
      build: jest.fn(async () => undefined),
    },
    incrementalIndexer: {
      enqueuePaths: jest.fn(() => 3),
    },
    pathNormalizer: {
      toAbsolute: jest.fn((p: string) => `/root/${p}`),
    },
    cacheInvalidationHub: {
      onEvent: jest.fn(),
    },
    toolSpecRegistry,
    ...overrides,
  }) as unknown as HandlerContext;

const parse = (response: any) => JSON.parse(response.content[0].text);

describe("KairoStatusHandler", () => {
  it("returns null for non-matching tool name", async () => {
    const handler = new KairoStatusHandler(makeContext());
    expect(await handler.handle("other_tool", {})).toBeNull();
  });

  it("returns overview by default", async () => {
    const handler = new KairoStatusHandler(makeContext());
    const response = await handler.handle("kairo_status", {});
    expect(response.isError).toBeFalsy();
    const result = parse(response);
    expect(result.searchIndex).toBeDefined();
    expect(result.searchIndex.available).toBe(true);
    expect(result.searchIndex.docCount).toBe(100);
  });

  it("returns full diagnostics with process info", async () => {
    const handler = new KairoStatusHandler(makeContext());
    const response = await handler.handle("kairo_status", { scope: "full" });
    const result = parse(response);
    expect(result.searchIndex).toBeDefined();
    expect(result.searchReady).toBe(true);
    expect(result.nativeStats).toBeDefined();
    expect(result.symbolIndex).toBeDefined();
    expect(result.process).toBeDefined();
    expect(result.process.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(result.process.memoryMb).toBeGreaterThanOrEqual(0);
  });

  it("returns search-specific info for scope=search", async () => {
    const handler = new KairoStatusHandler(makeContext());
    const response = await handler.handle("kairo_status", { scope: "search" });
    const result = parse(response);
    expect(result.searchReady).toBeDefined();
    expect(result.nativeStats).toBeDefined();
    // should NOT have process info
    expect(result.process).toBeUndefined();
  });

  it("returns symbol info for scope=symbols", async () => {
    const handler = new KairoStatusHandler(makeContext());
    const response = await handler.handle("kairo_status", { scope: "symbols" });
    const result = parse(response);
    expect(result.symbolIndex).toBeDefined();
    expect(result.symbolIndex.symbolCount).toBe(50);
  });

  it("triggers full reindex", async () => {
    const build = jest.fn(async () => undefined);
    const onEvent = jest.fn();
    const ctx = makeContext({
      dependencyGraph: { build },
      cacheInvalidationHub: { onEvent },
    });
    const handler = new KairoStatusHandler(ctx);
    const response = await handler.handle("kairo_status", { action: "reindex" });
    const result = parse(response);
    expect(result.success).toBe(true);
    expect(result.scope).toBe("full");
    expect(build).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalled();
  });

  it("triggers path-specific reindex", async () => {
    const enqueuePaths = jest.fn(() => 2);
    const ctx = makeContext({
      incrementalIndexer: { enqueuePaths },
      pathNormalizer: { toAbsolute: jest.fn((p: string) => `/root/${p}`) },
    });
    const handler = new KairoStatusHandler(ctx);
    const response = await handler.handle("kairo_status", {
      action: "reindex",
      paths: ["src/a.ts", "src/b.ts"],
    });
    const result = parse(response);
    expect(result.success).toBe(true);
    expect(result.scope).toBe("paths");
    expect(result.enqueued).toBe(2);
    expect(enqueuePaths).toHaveBeenCalledWith(["/root/src/a.ts", "/root/src/b.ts"], "high");
  });

  it("returns failure when path reindex and no incremental indexer", async () => {
    const ctx = makeContext({ incrementalIndexer: null });
    const handler = new KairoStatusHandler(ctx);
    const response = await handler.handle("kairo_status", {
      action: "reindex",
      paths: ["src/a.ts"],
    });
    const result = parse(response);
    expect(result.success).toBe(false);
    expect(result.hint).toBeDefined();
  });

  it("handles unavailable native search gracefully", async () => {
    const ctx = makeContext({
      searchEngine: {
        getNativeStatus: jest.fn(() => ({
          available: false,
          stats: null,
          error: "No native module",
        })),
        isIndexReady: jest.fn(() => false),
      },
    });
    const handler = new KairoStatusHandler(ctx);
    const response = await handler.handle("kairo_status", {});
    const result = parse(response);
    expect(result.searchIndex.available).toBe(false);
    expect(result.searchIndex.error).toBe("No native module");
  });

  it("returns StatusError on engine failure", async () => {
    const ctx = makeContext({
      searchEngine: {
        getNativeStatus: jest.fn(() => {
          throw new Error("crash");
        }),
      },
    });
    const handler = new KairoStatusHandler(ctx);
    const response = await handler.handle("kairo_status", {});
    expect(response.isError).toBe(true);
    expect(parse(response).errorCode).toBe("StatusError");
  });

  it("defaults action to check when omitted", async () => {
    const getNativeStatus = jest.fn(() => ({
      available: true,
      stats: { docCount: 0 },
      error: null,
    }));
    const ctx = makeContext({ searchEngine: { getNativeStatus, isIndexReady: jest.fn(() => true) } });
    const handler = new KairoStatusHandler(ctx);
    const response = await handler.handle("kairo_status", {});
    expect(response.isError).toBeFalsy();
    expect(getNativeStatus).toHaveBeenCalled();
  });

  it("has no legacy response fields", async () => {
    const handler = new KairoStatusHandler(makeContext());
    const response = await handler.handle("kairo_status", {});
    const result = parse(response);
    expect(result).not.toHaveProperty("degradedReasons");
    expect(result).not.toHaveProperty("guidance");
    expect(result).not.toHaveProperty("nextCalls");
    expect(result).not.toHaveProperty("contract");
    expect(result).not.toHaveProperty("sessionId");
  });
});
