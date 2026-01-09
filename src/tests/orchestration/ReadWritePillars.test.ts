import { describe, it, expect } from "@jest/globals";
import { ReadPillar } from "../../orchestration/pillars/ReadPillar.js";
import { WritePillar } from "../../orchestration/pillars/WritePillar.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";

describe("ReadPillar", () => {
  it("resolves filename-only targets via project_search (filename)", async () => {
    const registry = new InternalToolRegistry();
    const readCalls: any[] = [];
    registry.register("project_search", async (args: any) => ({
      results: [{ path: "src/orchestration/OrchestrationEngine.ts" }]
    } as any));
    registry.register("code_read", async (args: any) => {
      readCalls.push(args);
      return "SKELETON" as any;
    });
    registry.register("file_profile", async () => ({
      metadata: { relativePath: "src/orchestration/OrchestrationEngine.ts", lineCount: 1 },
      structure: { symbols: [] }
    } as any));

    const pillar = new ReadPillar(registry);
    const result = await pillar.execute({
      category: "read",
      action: "view",
      targets: ["OrchestrationEngine.ts"],
      originalIntent: "read OrchestrationEngine.ts",
      constraints: {},
      confidence: 1
    } as any, new OrchestrationContext());

    expect(result.metadata.filePath).toBe("src/orchestration/OrchestrationEngine.ts");
    expect(readCalls[0].filePath).toBe("src/orchestration/OrchestrationEngine.ts");
  });
});

describe("WritePillar", () => {
  it("uses file_write fast-path when content is provided", async () => {
    const registry = new InternalToolRegistry();
    const writeCalls: any[] = [];
    const editCalls: any[] = [];

    registry.register("project_search", async () => ({
      results: [{ path: "docs/draft.md" }]
    } as any));
    registry.register("code_read", async () => {
      throw new Error("missing");
    });
    registry.register("file_write", async (args: any) => {
      writeCalls.push(args);
      return { success: true } as any;
    });
    registry.register("edit_apply", async () => ({ success: true } as any));
    registry.register("edit_transaction", async (args: any) => {
      editCalls.push(args);
      return { success: true, operation: { id: "tx-1" } } as any;
    });

    const pillar = new WritePillar(registry);
    const result = await pillar.execute({
      category: "write",
      action: "create",
      targets: ["draft.md"],
      originalIntent: "create draft",
      constraints: { content: "# Draft" },
      confidence: 1
    } as any, new OrchestrationContext());

    expect(result.success).toBe(true);
    expect(writeCalls[0].filePath).toBe("docs/draft.md");
    expect(editCalls.length).toBe(0);
  });

  it("uses edit_transaction when safeWrite is true", async () => {
    const registry = new InternalToolRegistry();
    const writeCalls: any[] = [];
    const editCalls: any[] = [];

    registry.register("project_search", async () => ({
      results: [{ path: "docs/draft.md" }]
    } as any));
    registry.register("code_read", async () => {
      throw new Error("missing");
    });
    registry.register("file_write", async (args: any) => {
      writeCalls.push(args);
      return { success: true } as any;
    });
    registry.register("edit_apply", async () => ({ success: true } as any));
    registry.register("edit_transaction", async (args: any) => {
      editCalls.push(args);
      return { success: true, operation: { id: "tx-1" } } as any;
    });

    const pillar = new WritePillar(registry);
    const result = await pillar.execute({
      category: "write",
      action: "create",
      targets: ["draft.md"],
      originalIntent: "create draft",
      constraints: { content: "# Draft", safeWrite: true },
      confidence: 1
    } as any, new OrchestrationContext());

    expect(result.success).toBe(true);
    expect(writeCalls[0].filePath).toBe("docs/draft.md");
    expect(editCalls[0].filePath).toBe("docs/draft.md");
  });
});
