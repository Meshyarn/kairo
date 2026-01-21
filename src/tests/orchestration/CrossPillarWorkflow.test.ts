import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { OrchestrationEngine } from "../../orchestration/OrchestrationEngine.js";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { IntentRouter } from "../../orchestration/IntentRouter.js";
import { WorkflowPlanner } from "../../orchestration/WorkflowPlanner.js";

describe("Cross-Pillar Workflows", () => {
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

  it("passes explore evidence pack into change doc suggestions", async () => {
    const registry = new InternalToolRegistry();
    const docSearchCalls: any[] = [];

    registry.register("document_search", async (args: any) => {
      docSearchCalls.push(args);
      return {
        results: [
          {
            id: "doc-1",
            filePath: "docs/ARCHITECTURE.md",
            preview: "Use UserService",
            scores: { final: 0.9 }
          }
        ],
        pack: { packId: args?.packId ?? "pack-doc" }
      } as any;
    });
    registry.register("project_search", async () => ({
      results: [{ path: "src/index.ts", context: "export {};", score: 0.8, type: "file", line: 1 }]
    }) as any);
    registry.register("edit_transaction", async () => ({
      success: true,
      diff: "diff",
      operation: { id: "op-1" }
    }) as any);

    const engine = new OrchestrationEngine(new IntentRouter(), new WorkflowPlanner(), registry);
    const exploreResult = await engine.executePillar("explore", {
      query: "UserService"
    });

    const packId = exploreResult?.pack?.packId ?? "pack-doc";
    const priorCalls = docSearchCalls.length;
    const changeResult = await engine.executePillar("change", {
      intent: "Rename method",
      targetPath: "src/UserService.ts",
      edits: [{ targetString: "foo", replacementString: "bar" }],
      dryRun: false,
      suggestDocs: true,
      evidencePack: packId
    });

    const changeCalls = docSearchCalls.slice(priorCalls);
    expect(changeResult.success).toBe(true);
    expect(changeCalls.length).toBeGreaterThan(0);
    expect(changeCalls.every(call => call.packId === packId)).toBe(true);
  });

  it("feeds change target into understand analysis", async () => {
    const registry = new InternalToolRegistry();

    registry.register("edit_transaction", async () => ({
      success: true,
      diff: "diff",
      operation: { id: "op-2" }
    }) as any);
    registry.register("code_read", async () => "export const value = 1;" as any);
    registry.register("file_profile", async (args: any) => ({
      metadata: { filePath: args.filePath, lineCount: 1 },
      structure: { symbols: [] }
    }) as any);
    registry.register("project_profile", async () => ({ fileCount: 10 }) as any);
    registry.register("relationship_analyze", async () => ({
      edges: [{ from: "src/UserService.ts", to: "src/deps.ts", type: "dependency" }]
    }) as any);

    const engine = new OrchestrationEngine(new IntentRouter(), new WorkflowPlanner(), registry);
    const changeResult = await engine.executePillar("change", {
      intent: "Update UserService",
      targetPath: "src/UserService.ts",
      edits: [{ targetString: "short", replacementString: "longer" }],
      dryRun: true
    });

    const understandResult = await engine.executePillar("understand", {
      goal: changeResult.targetFile,
      include: { dependencies: true }
    });

    expect(understandResult.primaryFile).toBe("src/UserService.ts");
    expect(Array.isArray(understandResult.dependencies)).toBe(true);
  });
});
