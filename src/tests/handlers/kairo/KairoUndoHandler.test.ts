import { describe, it, expect, jest } from "@jest/globals";
import type { HandlerContext } from "../../../handlers/HandlerContext.js";
import { KairoUndoHandler } from "../../../handlers/kairo/KairoUndoHandler.js";
import { createDefaultToolSpecRegistry } from "../../../server/tools/ToolSpecRegistry.js";

const toolSpecRegistry = createDefaultToolSpecRegistry();

const makeContext = (overrides: Record<string, unknown> = {}): HandlerContext =>
  ({
    historyEngine: {
      undo: jest.fn(async () => null),
      redo: jest.fn(async () => null),
      getHistory: jest.fn(async () => ({ undoStack: [], redoStack: [] })),
    },
    toolSpecRegistry,
    ...overrides,
  }) as unknown as HandlerContext;

const parse = (response: any) => JSON.parse(response.content[0].text);

describe("KairoUndoHandler", () => {
  it("returns null for non-matching tool name", async () => {
    const handler = new KairoUndoHandler(makeContext());
    expect(await handler.handle("other_tool", {})).toBeNull();
  });

  it("returns empty history initially", async () => {
    const handler = new KairoUndoHandler(makeContext());
    const response = await handler.handle("kairo_undo", { action: "history" });
    expect(response.isError).toBeFalsy();
    const result = parse(response);
    expect(result.undo).toEqual([]);
    expect(result.redo).toEqual([]);
  });

  it("returns history with entries", async () => {
    const ctx = makeContext({
      historyEngine: {
        undo: jest.fn(),
        redo: jest.fn(),
        getHistory: jest.fn(async () => ({
          undoStack: [
            { id: "tx-1", description: "Edit a.ts", timestamp: 1000 },
            { id: "tx-2", description: "Edit b.ts", timestamp: 2000 },
          ],
          redoStack: [
            { id: "tx-3", description: "Edit c.ts", timestamp: 3000 },
          ],
        })),
      },
    });
    const handler = new KairoUndoHandler(ctx);
    const response = await handler.handle("kairo_undo", { action: "history" });
    const result = parse(response);
    expect(result.undo).toHaveLength(2);
    expect(result.undo[0].id).toBe("tx-2"); // reversed order (most recent first)
    expect(result.redo).toHaveLength(1);
  });

  it("respects limit on history", async () => {
    const ctx = makeContext({
      historyEngine: {
        undo: jest.fn(),
        redo: jest.fn(),
        getHistory: jest.fn(async () => ({
          undoStack: Array.from({ length: 20 }, (_, i) => ({
            id: `tx-${i}`,
            description: `Edit ${i}`,
            timestamp: i * 1000,
          })),
          redoStack: [],
        })),
      },
    });
    const handler = new KairoUndoHandler(ctx);
    const response = await handler.handle("kairo_undo", { action: "history", limit: 3 });
    const result = parse(response);
    expect(result.undo).toHaveLength(3);
  });

  it("returns success=false when nothing to undo", async () => {
    const handler = new KairoUndoHandler(makeContext());
    const response = await handler.handle("kairo_undo", { action: "undo" });
    expect(response.isError).toBeFalsy();
    const result = parse(response);
    expect(result.success).toBe(false);
    expect(result.hint).toBeDefined();
  });

  it("returns success=true when undo succeeds", async () => {
    const ctx = makeContext({
      historyEngine: {
        undo: jest.fn(async () => ({ id: "tx-1", description: "Edit a.ts" })),
        redo: jest.fn(),
        getHistory: jest.fn(),
      },
    });
    const handler = new KairoUndoHandler(ctx);
    const response = await handler.handle("kairo_undo", { action: "undo" });
    const result = parse(response);
    expect(result.success).toBe(true);
    expect(result.undone).toBe("Edit a.ts");
  });

  it("returns success=false when nothing to redo", async () => {
    const handler = new KairoUndoHandler(makeContext());
    const response = await handler.handle("kairo_undo", { action: "redo" });
    const result = parse(response);
    expect(result.success).toBe(false);
  });

  it("returns success=true when redo succeeds", async () => {
    const ctx = makeContext({
      historyEngine: {
        undo: jest.fn(),
        redo: jest.fn(async () => ({ id: "tx-2", description: "Edit b.ts" })),
        getHistory: jest.fn(),
      },
    });
    const handler = new KairoUndoHandler(ctx);
    const response = await handler.handle("kairo_undo", { action: "redo" });
    const result = parse(response);
    expect(result.success).toBe(true);
    expect(result.redone).toBe("Edit b.ts");
  });

  it("returns error for invalid action", async () => {
    const handler = new KairoUndoHandler(makeContext());
    const response = await handler.handle("kairo_undo", { action: "invalid" });
    expect(response.isError).toBe(true);
    expect(parse(response).errorCode).toBe("InvalidAction");
  });

  it("defaults to history action when action is omitted", async () => {
    const getHistory = jest.fn(async () => ({ undoStack: [], redoStack: [] }));
    const ctx = makeContext({
      historyEngine: { undo: jest.fn(), redo: jest.fn(), getHistory },
    });
    const handler = new KairoUndoHandler(ctx);
    await handler.handle("kairo_undo", {});
    expect(getHistory).toHaveBeenCalled();
  });

  it("returns UndoError on engine failure", async () => {
    const ctx = makeContext({
      historyEngine: {
        undo: jest.fn(async () => {
          throw new Error("crash");
        }),
        redo: jest.fn(),
        getHistory: jest.fn(),
      },
    });
    const handler = new KairoUndoHandler(ctx);
    const response = await handler.handle("kairo_undo", { action: "undo" });
    expect(response.isError).toBe(true);
    expect(parse(response).errorCode).toBe("UndoError");
  });

  it("has no legacy response fields", async () => {
    const handler = new KairoUndoHandler(makeContext());
    const response = await handler.handle("kairo_undo", { action: "history" });
    const result = parse(response);
    expect(result).not.toHaveProperty("degradedReasons");
    expect(result).not.toHaveProperty("guidance");
    expect(result).not.toHaveProperty("nextCalls");
    expect(result).not.toHaveProperty("contract");
  });
});
