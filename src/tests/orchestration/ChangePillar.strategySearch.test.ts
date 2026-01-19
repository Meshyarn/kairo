import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { ChangePillar } from "../../orchestration/pillars/change/ChangePillar.js";

describe("ChangePillar strategySearch", () => {
  const originalParity = process.env.KAIRO_SKIP_PARITY_CHECK;

  beforeEach(() => {
    process.env.KAIRO_SKIP_PARITY_CHECK = "true";
  });

  afterEach(() => {
    if (originalParity === undefined) {
      delete process.env.KAIRO_SKIP_PARITY_CHECK;
    } else {
      process.env.KAIRO_SKIP_PARITY_CHECK = originalParity;
    }
  });

  it("selects the best candidate and applies its edits", async () => {
    const registry = new InternalToolRegistry();
    const editCalls: any[] = [];
    registry.register("edit_transaction", async (args: any) => {
      editCalls.push(args);
      const target = args?.edits?.[0]?.targetString ?? "";
      if (target === "A") {
        return { success: true, diff: "diffA", structuredDiff: [{ added: 5, removed: 0 }] } as any;
      }
      if (target === "B") {
        return { success: true, diff: "diffB", structuredDiff: [{ added: 20, removed: 0 }] } as any;
      }
      return { success: true, diff: "diffBase", structuredDiff: [{ added: 10, removed: 0 }] } as any;
    });
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
        includeImpact: false,
        edits: [{ targetString: "BASE", replacementString: "BASE_NEW" }],
        strategySearch: {
          mode: "force",
          stage: "r1",
          candidates: [
            { id: "c1", edits: [{ targetString: "A", replacementString: "A1" }] },
            { id: "c2", edits: [{ targetString: "B", replacementString: "B1" }] }
          ]
        }
      },
      confidence: 1
    };

    const result = await pillar.execute(intent as any, new OrchestrationContext());
    expect(result.success).toBe(true);
    expect(result.strategySearch?.selectedCandidateId).toBe("c1");

    const lastCall = editCalls[editCalls.length - 1];
    expect(lastCall.edits[0].targetString).toBe("A");
  });

  it("falls back when all candidates fail", async () => {
    const registry = new InternalToolRegistry();
    const editCalls: any[] = [];
    registry.register("edit_transaction", async (args: any) => {
      editCalls.push(args);
      const target = args?.edits?.[0]?.targetString ?? "";
      if (target === "FAIL") {
        return { success: false, message: "Candidate failed" } as any;
      }
      return { success: true, diff: "diffBase", structuredDiff: [{ added: 3, removed: 0 }] } as any;
    });
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
        includeImpact: false,
        edits: [{ targetString: "BASE", replacementString: "BASE_NEW" }],
        strategySearch: {
          mode: "force",
          stage: "r1",
          candidates: [
            { id: "c1", edits: [{ targetString: "FAIL", replacementString: "X" }] }
          ]
        }
      },
      confidence: 1
    };

    const result = await pillar.execute(intent as any, new OrchestrationContext());
    expect(result.success).toBe(true);
    expect(result.strategySearch?.degradedReasons).toContain("reasoning_all_failed");

    const lastCall = editCalls[editCalls.length - 1];
    expect(lastCall.edits[0].targetString).toBe("BASE");
  });
});
