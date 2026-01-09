import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { ChangePillar } from "../../orchestration/pillars/change/ChangePillar.js";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { FlowArtifactManager } from "../../orchestration/flow-artifact-manager.js";

describe("ChangePillar Branches", () => {
  let pillar: ChangePillar;
  let registry: InternalToolRegistry;
  let context: OrchestrationContext;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new InternalToolRegistry();
    context = new OrchestrationContext();
    pillar = new ChangePillar(registry);
  });

  it("covers budget allowLevenshtein=false branches", async () => {
    // Mocking the result of internal tool calls to trigger branches
    jest.spyOn(registry, "execute").mockImplementation(async (tool, args) => {
      if (tool === "edit_transaction") return { success: false, message: "failed" };
      if (tool === "file_stat") return { size: 500000 }; // Large file branch
      return { success: true };
    });

    const intent = {
      targets: ["large.ts"],
      constraints: { dryRun: false, edits: [{ targetString: "too short for levenshtein" }] },
      originalIntent: "edit"
    };

    const result = await pillar.execute(intent as any, context);
    expect(result.autoCorrectionAttempts).toEqual(["whitespace", "structural"]);
    expect(result.autoCorrectionAttempts).not.toContain("fuzzy");
  });

  it("covers auto-correction flow branches", async () => {
    let tryCount = 0;
    jest.spyOn(registry, "execute").mockImplementation(async (tool, args) => {
      if (tool === "edit_transaction") {
        tryCount++;
        if (tryCount === 1) return { success: false }; // First try fails
        return { success: true }; // Corrected try succeeds
      }
      return { success: true };
    });

    const intent = {
      targets: ["a.ts"],
      constraints: { dryRun: true, edits: [{ targetString: "StrongMatchTarget", replacement: "b" }] },
      originalIntent: "edit"
    };

    const result = await pillar.execute(intent as any, context);
    expect(result.autoCorrected).toBe(true);
  });

  it("covers failure message branches", async () => {
    jest.spyOn(registry, "execute").mockResolvedValue({ success: false, message: "hard failure" } as any);
    
    const intent = {
      targets: ["a.ts"],
      constraints: { edits: [{ targetString: "a" }] },
      originalIntent: "fail me"
    };

    const result = await pillar.execute(intent as any, context);
    expect(result.success).toBe(false);
    expect(result.message).toBe("hard failure");
  });

  it("chains draftId and refinement in dryRun drafts", async () => {
    const manager = new FlowArtifactManager();
    registry.setMetadata("flowArtifactManager", manager);
    jest.spyOn(registry, "execute").mockImplementation(async (tool) => {
      if (tool === "edit_transaction") {
        return {
          success: true,
          diff: "diff",
          impactPreview: { riskLevel: "low", summary: { impactedFiles: [] } }
        } as any;
      }
      if (tool === "relationship_analyze") return { nodes: [], edges: [] } as any;
      if (tool === "hotspot_detect") return [] as any;
      return { success: true } as any;
    });

    const intent = {
      targets: ["src/demo.ts"],
      constraints: {
        dryRun: true,
        edits: [{ targetString: "a", replacementString: "b" }],
        draftId: "draft_seed",
        refinement: "add error handling"
      },
      originalIntent: "update demo"
    };

    const result = await pillar.execute(intent as any, context);
    expect(result.success).toBe(true);
    expect(result.draftPack.intent).toContain("Refinement: add error handling");
    const drafts = manager.getByType("draft");
    expect(drafts[0]?.parentId).toBe("draft_seed");
  });
});
