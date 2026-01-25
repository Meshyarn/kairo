import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { ChangePillar } from "../../orchestration/pillars/change/ChangePillar.js";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { FlowArtifactManager } from "../../orchestration/flow-artifact-manager.js";

describe("ChangePillar Branches", () => {
  let pillar: ChangePillar;
  let registry: InternalToolRegistry;
  let context: OrchestrationContext;
  let originalSkipParity: string | undefined;

  beforeEach(() => {
    originalSkipParity = process.env.KAIRO_SKIP_PARITY_CHECK;
    process.env.KAIRO_SKIP_PARITY_CHECK = "true";
    jest.clearAllMocks();
    registry = new InternalToolRegistry();
    context = new OrchestrationContext();
    pillar = new ChangePillar(registry);
  });

  afterEach(() => {
    if (originalSkipParity === undefined) {
      delete process.env.KAIRO_SKIP_PARITY_CHECK;
    } else {
      process.env.KAIRO_SKIP_PARITY_CHECK = originalSkipParity;
    }
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
      constraints: { dryRun: true, edits: [{ targetString: "too short for levenshtein", replacementString: "replacement" }] },
      originalIntent: "edit large.ts"
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

  it("applies draftId when edits are missing", async () => {
    const originalMode = process.env.KAIRO_MODE;
    process.env.KAIRO_MODE = "dev";
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kairo-change-draft-"));
    const filePath = path.join(tempDir, "demo.ts");
    try {
      await fs.writeFile(filePath, "export const value = 1;\n");
      const manager = new FlowArtifactManager();
      const draftId = "draft_seed_apply";
      manager.store({
        id: draftId,
        type: "draft",
        createdAt: Date.now(),
        pack: {
          id: draftId,
          intent: "apply draft",
          skeleton: { content: "", signatures: [], structure: { imports: [], exports: [], dependencies: [] }, placeholders: [] },
          phantomFiles: [{
            path: filePath,
            content: "export const value = 2;\n",
            isNew: false,
            language: "ts"
          }],
          preflightCheck: { syntaxValid: true, typesResolvable: true, guardrailsPassed: true, warnings: [] },
          createdAt: Date.now(),
          status: "pending"
        }
      } as any);
      registry.setMetadata("flowArtifactManager", manager);

      const editCalls: any[] = [];
      jest.spyOn(registry, "execute").mockImplementation(async (tool, args) => {
        if (tool === "edit_transaction") {
          editCalls.push(args);
          return { success: true, diff: "diff" } as any;
        }
        if (tool === "impact_analyze") return { riskLevel: "low" } as any;
        if (tool === "relationship_analyze") return { nodes: [], edges: [] } as any;
        if (tool === "hotspot_detect") return [] as any;
        return { success: true } as any;
      });

      const result = await pillar.execute({
        targets: [],
        constraints: { dryRun: false, draftId, targetPath: filePath },
        originalIntent: "apply draft"
      } as any, context);

      expect(result.success).toBe(true);
      expect(editCalls[0].edits[0].replacementString).toBe("export const value = 2;\n");
    } finally {
      if (originalMode === undefined) {
        delete process.env.KAIRO_MODE;
      } else {
        process.env.KAIRO_MODE = originalMode;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks apply when apply token is missing in mcp mode", async () => {
    const originalMode = process.env.KAIRO_MODE;
    process.env.KAIRO_MODE = "mcp";
    try {
      const manager = new FlowArtifactManager();
      registry.setMetadata("flowArtifactManager", manager);

      const result = await pillar.execute({
        targets: ["src/app.ts"],
        constraints: {
          safety: "apply",
          draftId: "draft_missing_token",
          edits: [{ targetString: "a", replacementString: "b" }]
        },
        originalIntent: "apply change"
      } as any, context);

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
});
