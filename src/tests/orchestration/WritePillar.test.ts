import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { WritePillar } from "../../orchestration/pillars/WritePillar.js";
import { FlowArtifactManager } from "../../orchestration/flow-artifact-manager.js";

const makeIntent = (constraints: Record<string, any>) => ({
  category: "write",
  action: "execute",
  targets: [],
  originalIntent: "create function greet returns string",
  constraints,
  confidence: 1
});

jest.setTimeout(30000);

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

  it("fails when targetPath is missing", async () => {
    const registry = new InternalToolRegistry();
    const pillar = new WritePillar(registry);
    const context = new OrchestrationContext();

    const result = await pillar.execute(makeIntent({}) as any, context);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failure");
  });

  it("quickGenerate writes generated code", async () => {
    const registry = new InternalToolRegistry();
    registry.register("code_read", async () => {
      throw new Error("missing");
    });
    registry.register("file_write", async () => ({ success: true }));
    registry.register("edit_transaction", async () => ({ success: true, operation: { id: "op-1" } }));

    const pillar = new WritePillar(registry);
    const context = new OrchestrationContext();
    const result = await pillar.execute(
      makeIntent({ targetPath: "src/greet.ts", quickGenerate: true }) as any,
      context
    );

    expect(result.success).toBe(true);
    expect(result.writeMode).toBe("quickGenerate");
    expect(result.createdFiles[0].path).toBe("src/greet.ts");
  });

  it("safeWrite uses edit_transaction with hashes", async () => {
    const registry = new InternalToolRegistry();
    registry.register("code_read", async () => "old");
    registry.register("edit_transaction", async () => ({ success: true, operation: { id: "op-2" } }));

    const pillar = new WritePillar(registry);
    const context = new OrchestrationContext();
    const result = await pillar.execute(
      makeIntent({ targetPath: "src/output.ts", content: "new", safeWrite: true }) as any,
      context
    );

    expect(result.success).toBe(true);
    expect(result.writeMode).toBe("safe");
    expect(result.rollbackAvailable).toBe(true);
  });

  it("prefers contentSource inline over content", async () => {
    const registry = new InternalToolRegistry();
    registry.register("code_read", async () => "");
    const editTransaction: jest.MockedFunction<(args: any) => Promise<any>> = jest
      .fn(async () => ({ success: true, operation: { id: "op-inline" } })) as any;
    registry.register("edit_transaction", editTransaction);

    const pillar = new WritePillar(registry);
    const context = new OrchestrationContext();
    const result = await pillar.execute(
      makeIntent({
        targetPath: "src/inline.ts",
        content: "old",
        contentSource: { kind: "inline", text: "new" },
        safeWrite: true
      }) as any,
      context
    );

    expect(result.success).toBe(true);
    expect(editTransaction).toHaveBeenCalled();
    const [firstCall] = editTransaction.mock.calls;
    expect(firstCall).toBeDefined();
    const args = firstCall?.[0] as any;
    expect(args?.edits?.[0]?.replacementString).toBe("new");
  });

  it("blocks apply when reviewOptions.blockOn triggers", async () => {
    const registry = new InternalToolRegistry();
    registry.register("code_read", async () => "");
    const editTransaction = jest.fn(async () => ({ success: true, operation: { id: "op-3" } }));
    registry.register("edit_transaction", editTransaction);

    const pillar = new WritePillar(registry);
    const context = new OrchestrationContext();
    const result = await pillar.execute(
      makeIntent({
        targetPath: "src/bad.ts",
        content: "export const =",
        safeWrite: true,
        reviewOptions: { blockOn: ["syntax"] }
      }) as any,
      context
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toBe("review_blocked");
    expect(Array.isArray(result.reviewBlockReasons)).toBe(true);
    expect(editTransaction).not.toHaveBeenCalled();
  });

  it("blocks apply when reviewOptions.blockOn triggers semantic", async () => {
    const originalSemantic = process.env.MCP_VALIDATION_SEMANTIC;
    process.env.MCP_VALIDATION_SEMANTIC = "error";
    try {
      const registry = new InternalToolRegistry();
      registry.register("code_read", async () => "");
      const editTransaction = jest.fn(async () => ({ success: true, operation: { id: "op-3" } }));
      registry.register("edit_transaction", editTransaction);

      const pillar = new WritePillar(registry);
      const context = new OrchestrationContext();
      const result = await pillar.execute(
        makeIntent({
          targetPath: "src/bad.ts",
          content: "export const value = __kairo_missing_symbol__;",
          safeWrite: true,
          reviewOptions: { blockOn: ["semantic"] }
        }) as any,
        context
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toBe("review_blocked");
      expect(Array.isArray(result.reviewBlockReasons)).toBe(true);
      expect(editTransaction).not.toHaveBeenCalled();
    } finally {
      if (originalSemantic === undefined) {
        delete process.env.MCP_VALIDATION_SEMANTIC;
      } else {
        process.env.MCP_VALIDATION_SEMANTIC = originalSemantic;
      }
    }
  });

  it("reuses draft content when draftId is provided in dryRun", async () => {
    const registry = new InternalToolRegistry();
    registry.register("code_read", async () => {
      throw new Error("missing");
    });
    const manager = new FlowArtifactManager();
    const draftId = "draft_seed";
    manager.store({
      id: draftId,
      type: "draft",
      createdAt: Date.now(),
      pack: {
        id: draftId,
        intent: "seed",
        skeleton: { content: "", signatures: [], structure: { imports: [], exports: [], dependencies: [] }, placeholders: [] },
        phantomFiles: [{
          path: "src/seed.ts",
          content: "export const seed = 1;\n",
          isNew: true,
          language: "ts"
        }],
        preflightCheck: { syntaxValid: true, typesResolvable: true, guardrailsPassed: true, warnings: [] },
        createdAt: Date.now(),
        status: "pending"
      }
    } as any);
    registry.setMetadata("flowArtifactManager", manager);

    const pillar = new WritePillar(registry);
    const context = new OrchestrationContext();
    const result = await pillar.execute(
      makeIntent({ targetPath: "src/seed.ts", dryRun: true, draftId }) as any,
      context
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe("draft");
    expect(result.draftPack.phantomFiles[0].content).toBe("export const seed = 1;\n");
  });

  it("blocks apply when apply token is missing in mcp mode", async () => {
    const originalMode = process.env.KAIRO_MODE;
    process.env.KAIRO_MODE = "mcp";
    try {
      const registry = new InternalToolRegistry();
      registry.setMetadata("flowArtifactManager", new FlowArtifactManager());
      const pillar = new WritePillar(registry);
      const context = new OrchestrationContext();

      const result = await pillar.execute(
        makeIntent({ targetPath: "src/app.ts", safety: "apply", draftId: "draft_missing_token" }) as any,
        context
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe("blocked");
      expect(result.degradedReasons?.[0]?.type ?? result.degradedReasons?.[0]).toBe("apply_token_missing");
    } finally {
      if (originalMode === undefined) {
        delete process.env.KAIRO_MODE;
      } else {
        process.env.KAIRO_MODE = originalMode;
      }
    }
  });

  it("parses generation intent helpers", () => {
    const registry = new InternalToolRegistry();
    const pillar = new WritePillar(registry);

    const parsed = (pillar as any).parseGenerationIntent(
      "create class Widget",
      "src/widget.ts"
    );
    expect(parsed.templateType).toBe("class");
    expect(parsed.context.name).toBe("Widget");

    expect((pillar as any).extractParams("function takes a, b and c")).toBe("a, b, c");
    expect((pillar as any).extractReturnType("returns Promise<string>")).toBe("Promise<string>");
    expect((pillar as any).extractDescription("create a helper"))
      .toBe("Helper");
  });
});
