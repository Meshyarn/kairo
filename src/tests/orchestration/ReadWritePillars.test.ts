import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
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

  it("returns budget_exceeded degraded reasons when token budget applies", async () => {
    const registry = new InternalToolRegistry();
    registry.register("code_read", async () => "const value = 1;\n".repeat(50));
    registry.register("file_profile", async () => ({
      metadata: { relativePath: "src/large.ts", lineCount: 50, language: "typescript" },
      structure: { symbols: [] }
    } as any));

    const pillar = new ReadPillar(registry);
    const result = await pillar.execute({
      category: "read",
      action: "view",
      targets: ["src/large.ts"],
      originalIntent: "read src/large.ts",
      constraints: { view: "full", limits: { maxTokens: 1 } },
      confidence: 1
    } as any, new OrchestrationContext());

    expect(result.degraded).toBe(true);
    expect(result.degradedReasons?.some((reason: any) => reason.type === "budget_exceeded")).toBe(true);
    expect(result.compression?.applied).toBe(true);
  });

  it("surfaces doc_search_skipped in degraded reasons for document skeleton reads", async () => {
    const registry = new InternalToolRegistry();
    registry.register("project_search", async () => ({
      results: [{ path: "README.md" }]
    } as any));
    registry.register("document_skeleton", async () => ({
      skeleton: "# Title\n",
      outline: [],
      reasons: ["doc_search_skipped"],
      degraded: true
    } as any));
    registry.register("file_profile", async () => ({
      metadata: { relativePath: "README.md", lineCount: 1, language: "markdown" },
      structure: { symbols: [] }
    } as any));

    const pillar = new ReadPillar(registry);
    const result = await pillar.execute({
      category: "read",
      action: "view",
      targets: ["README.md"],
      originalIntent: "read README.md",
      constraints: { view: "skeleton" },
      confidence: 1
    } as any, new OrchestrationContext());

    expect(result.degradedReasons?.some((reason: any) => reason.type === "doc_search_skipped")).toBe(true);
    const actions = result.guidance?.suggestedActions ?? [];
    expect(actions.find((action: any) => action.id === "read.view_full")).toBeDefined();
  });
});

describe("WritePillar", () => {
  const originalMode = process.env.KAIRO_MODE;

  beforeEach(() => {
    process.env.KAIRO_MODE = "dev";
  });

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.KAIRO_MODE;
    } else {
      process.env.KAIRO_MODE = originalMode;
    }
  });

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
