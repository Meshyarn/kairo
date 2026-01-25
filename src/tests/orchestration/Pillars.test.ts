import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { UnderstandPillar } from "../../orchestration/pillars/UnderstandPillar.js";
import { ChangePillar } from "../../orchestration/pillars/change/ChangePillar.js";

const baseIntent = {
  category: "understand" as const,
  action: "analyze",
  targets: [],
  originalIntent: "analyze demo",
  constraints: {},
  confidence: 1
};

describe("Pillars", () => {
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

  it("UnderstandPillar returns skeleton string and hotspots", async () => {
    const registry = new InternalToolRegistry();
    registry.register("project_search", async () => ({
      results: [{ path: "src/demo.ts" }]
    } as any));
    registry.register("code_read", async () => "SKELETON" as any);
    registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] } as any));
    registry.register("hotspot_detect", async () => ([{ filePath: "src/demo.ts" }] as any));
    registry.register("file_profile", async () => ({
      metadata: { filePath: "src/demo.ts", lineCount: 1, language: "ts" },
      structure: { symbols: [] }
    } as any));

    const pillar = new UnderstandPillar(registry);
    const intent = {
      ...baseIntent,
      constraints: { include: { hotSpots: true } }
    };
    const result = await pillar.execute(intent as any, new OrchestrationContext());

    expect(result.structure).toBe("SKELETON");
    expect(Array.isArray(result.hotSpots)).toBe(true);
    expect(result.hotSpots.length).toBe(1);
  });

  it("ChangePillar uses edit_transaction and returns impact", async () => {
    const registry = new InternalToolRegistry();
    registry.register("edit_transaction", async () => ({
      success: true,
      diff: "diff",
      impactPreview: { riskLevel: "low", summary: { impactedFiles: [] } }
    } as any));
    registry.register("impact_analyze", async () => ({ riskLevel: "low" } as any));
    registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] } as any));
    registry.register("hotspot_detect", async () => ([] as any));

    const pillar = new ChangePillar(registry);
    const intent = {
      category: "change",
      action: "modify",
      targets: ["src/demo.ts"],
      originalIntent: "update demo",
      constraints: {
        dryRun: true,
        includeImpact: true,
        edits: [{ targetString: "a", replacementString: "b" }]
      },
      confidence: 1
    };

    const result = await pillar.execute(intent as any, new OrchestrationContext());
    expect(result.success).toBe(true);
    expect(result.impactReport).toBeTruthy();
  });

  it("ChangePillar normalizes legacy target/replacement edits", async () => {
    const registry = new InternalToolRegistry();
    const editCalls: any[] = [];
    registry.register("edit_transaction", async (args: any) => {
      editCalls.push(args);
      return {
        success: true,
        diff: "diff",
        impactPreview: { riskLevel: "low", summary: { impactedFiles: [] } }
      } as any;
    });
    registry.register("impact_analyze", async () => ({ riskLevel: "low" } as any));
    registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] } as any));
    registry.register("hotspot_detect", async () => ([] as any));

    const pillar = new ChangePillar(registry);
    const intent = {
      category: "change",
      action: "modify",
      targets: ["src/demo.ts"],
      originalIntent: "update demo",
      constraints: {
        dryRun: true,
        includeImpact: true,
        edits: [{ target: "OLD_CODE", replacement: "NEW_CODE" }]
      },
      confidence: 1
    };

    const result = await pillar.execute(intent as any, new OrchestrationContext());
    expect(result.success).toBe(true);
    expect(editCalls[0].filePath).toBe("src/demo.ts");
    expect(editCalls[0].edits[0].targetString).toBe("OLD_CODE");
    expect(editCalls[0].edits[0].replacementString).toBe("NEW_CODE");
  });

  it("ChangePillar attaches related docs using document_section", async () => {
    const registry = new InternalToolRegistry();
    registry.register("edit_transaction", async () => ({
      success: true,
      diff: "diff",
      impactPreview: { riskLevel: "low", summary: { impactedFiles: [] } }
    } as any));
    registry.register("impact_analyze", async () => ({ riskLevel: "low" } as any));
    registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] } as any));
    registry.register("hotspot_detect", async () => ([] as any));
    registry.register("document_search", async () => ({
      results: [
        {
          id: "chunk-1",
          filePath: "docs/guide.md",
          sectionPath: ["Setup"],
          scores: { final: 0.9 },
          preview: "Setup section"
        }
      ],
      pack: { packId: "pack-1", hit: false, createdAt: Date.now() }
    } as any));
    registry.register("document_section", async () => ({
      success: true,
      content: "Setup section content",
      resolvedHeadingPath: ["Setup"]
    } as any));

    const pillar = new ChangePillar(registry);
    const intent = {
      category: "change",
      action: "modify",
      targets: ["src/demo.ts"],
      originalIntent: "update demo",
      constraints: {
        dryRun: false,
        includeImpact: false,
        suggestDocs: true,
        edits: [{ targetString: "a", replacementString: "b" }]
      },
      confidence: 1
    };

    const result = await pillar.execute(intent as any, new OrchestrationContext());
    expect(result.success).toBe(true);
    expect(Array.isArray(result.relatedDocs)).toBe(true);
    expect(result.relatedDocs.length).toBeGreaterThan(0);
    // Phase 4: token-aware defaults avoid auto-attaching document_section content.
    expect(result.relatedDocs[0].section).toBeUndefined();
    expect(result.relatedDocs[0].packId).toBe("pack-1");
    const actions = result.guidance?.suggestedActions ?? [];
    expect(actions.some((action: any) => action?.toolCall?.tool === "document_section")).toBe(true);
  });
});
