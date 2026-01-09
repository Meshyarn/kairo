import { describe, it, expect } from "@jest/globals";
import { ManagePillar } from "../../orchestration/pillars/ManagePillar.js";
import { NavigatePillar } from "../../orchestration/pillars/NavigatePillar.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";

const baseIntent = {
  category: "manage",
  action: "status",
  targets: [],
  originalIntent: "status",
  constraints: {},
  confidence: 1
};

describe("ManagePillar", () => {
  it("routes status and history commands", async () => {
    const registry = new InternalToolRegistry();
    registry.register("project_manage", async (args: any) => ({
      ok: true,
      command: args.command,
      target: args.target
    } as any));

    const pillar = new ManagePillar(registry);
    const status = await pillar.execute({ ...baseIntent, action: "status" } as any, new OrchestrationContext());
    const history = await pillar.execute({ ...baseIntent, action: "history" } as any, new OrchestrationContext());

    expect(status.result.command).toBe("status");
    expect(history.result.command).toBe("history");
  });

  it("routes rebuild, undo, and fallback intents", async () => {
    const registry = new InternalToolRegistry();
    registry.register("project_manage", async (args: any) => ({
      success: true,
      status: { status: "ready" },
      history: { pendingTransactions: [1, 2] },
      command: args.command
    } as any));

    const pillar = new ManagePillar(registry);
    const rebuild = await pillar.execute({ ...baseIntent, action: "rebuild" } as any, new OrchestrationContext());
    const undo = await pillar.execute({ ...baseIntent, action: "undo" } as any, new OrchestrationContext());
    const fallback = await pillar.execute({ ...baseIntent, action: "unknown", originalIntent: "redo project" } as any, new OrchestrationContext());

    expect(rebuild.result.command).toBe("reindex");
    expect(undo.result.command).toBe("undo");
    expect(fallback.result.command).toBe("redo");
    expect(fallback.projectState?.indexStatus).toBe("ready");
  });
});

describe("NavigatePillar", () => {
  it("returns smartProfile for single result", async () => {
    const registry = new InternalToolRegistry();
    registry.register("project_search", async () => ({
      results: [{ path: "src/demo.ts", context: "preview" }]
    } as any));
    registry.register("file_profile", async () => ({
      metadata: { filePath: "src/demo.ts" },
      structure: { symbols: [] }
    } as any));
    registry.register("code_read", async () => "SKELETON" as any);
    registry.register("hotspot_detect", async () => ([] as any));
    registry.register("relationship_analyze", async () => ({ edges: [] } as any));

    const pillar = new NavigatePillar(registry);
    const result = await pillar.execute({
      category: "navigate",
      action: "find",
      targets: ["demo"],
      originalIntent: "find demo",
      constraints: {},
      confidence: 1
    } as any, new OrchestrationContext());

    expect(result.smartProfile).toBeDefined();
    expect(result.codePreview).toBe("SKELETON");
  });
});
