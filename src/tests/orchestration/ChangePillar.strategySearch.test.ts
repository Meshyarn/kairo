import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { ChangePillar } from "../../orchestration/pillars/change/ChangePillar.js";
import { SymbolicGuardEngine } from "../../engine/validators/symbolic-guard-engine.js";
import { MemoryFileSystem } from "../../platform/FileSystem.js";

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

  it("prefers lower contract/guard risk candidates", async () => {
    const registry = new InternalToolRegistry();
    registry.register("edit_transaction", async (args: any) => {
      const target = args?.edits?.[0]?.targetString ?? "";
      const content = target === "A" ? "BREAK_GUARD" : "SAFE_GUARD";
      return {
        success: true,
        diff: "diff",
        structuredDiff: [{ added: 5, removed: 0 }],
        newContent: content
      } as any;
    });
    registry.register("impact_analyze", async () => ({ riskLevel: "low" } as any));
    registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] } as any));
    registry.register("hotspot_detect", async () => ([] as any));

    const originalEnabled = process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED;
    const originalMode = process.env.KAIRO_SYMBOLIC_GUARDS_MODE;
    process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED = "true";
    process.env.KAIRO_SYMBOLIC_GUARDS_MODE = "warn";

    const guardSpy = jest.spyOn(SymbolicGuardEngine.prototype, "evaluate");
    guardSpy.mockImplementation(async ({ content }) => {
      const isRisky = String(content).includes("BREAK_GUARD");
      return {
        enabled: true,
        mode: "warn",
        diagnostics: isRisky
          ? [{ code: "index_bounds", severity: "high", message: "guard high" }]
          : [],
        degradedReasons: [],
        stats: { durationMs: 1, queryUsed: true, solverUsed: false }
      };
    });

    const pillar = new ChangePillar(registry) as any;
    pillar.buildCrossLangImpact = jest.fn(async (_targetPath: string, _context: any, options?: any) => {
      if (String(options?.afterContent).includes("BREAK_GUARD")) {
        return {
          packageName: "demo",
          consumerFiles: ["src/consumer.ts"],
          changedExports: ["foo"],
          breakingExports: ["foo"],
          degraded: false
        };
      }
      return {
        packageName: "demo",
        consumerFiles: [],
        changedExports: [],
        degraded: false
      };
    });

    const intent = {
      category: "change",
      action: "modify",
      targets: ["src/demo.ts"],
      originalIntent: "update demo",
      constraints: {
        dryRun: true,
        includeImpact: true,
        edits: [{ targetString: "BASE", replacementString: "BASE_NEW" }],
        strategySearch: {
          mode: "force",
          stage: "r1",
          candidates: [
            { id: "risky", edits: [{ targetString: "A", replacementString: "A1" }] },
            { id: "safe", edits: [{ targetString: "B", replacementString: "B1" }] }
          ]
        }
      },
      confidence: 1
    };

    try {
      const result = await pillar.execute(intent as any, new OrchestrationContext());
      expect(result.success).toBe(true);
      expect(result.strategySearch?.selectedCandidateId).toBe("safe");
      const candidates = Array.isArray(result.strategySearch?.candidates)
        ? result.strategySearch.candidates
        : [];
      const risky = candidates.find((item: any) => item.id === "risky");
      const safe = candidates.find((item: any) => item.id === "safe");
      expect(risky?.rewardBreakdown?.penalties?.contract ?? 0).toBeGreaterThan(0);
      expect(risky?.rewardBreakdown?.penalties?.guardsHigh ?? 0).toBeGreaterThan(0);
      expect(safe?.rewardBreakdown?.penalties?.contract ?? 0).toBe(0);
    } finally {
      guardSpy.mockRestore();
      if (originalEnabled === undefined) {
        delete process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED;
      } else {
        process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED = originalEnabled;
      }
      if (originalMode === undefined) {
        delete process.env.KAIRO_SYMBOLIC_GUARDS_MODE;
      } else {
        process.env.KAIRO_SYMBOLIC_GUARDS_MODE = originalMode;
      }
    }
  });

  it("evaluates contract/guards for batch candidates", async () => {
    const registry = new InternalToolRegistry();
    const fileSystem = new MemoryFileSystem(process.cwd());
    await fileSystem.writeFile("src/a.ts", "const value = OLD_A;\n");
    await fileSystem.writeFile("src/b.ts", "const value = OLD_B;\n");
    registry.setMetadata("fileSystem", fileSystem);

    registry.register("edit_transaction", async () => ({
      success: true,
      diff: "diff",
      structuredDiff: [{ added: 4, removed: 0 }]
    }) as any);
    registry.register("impact_analyze", async () => ({ riskLevel: "low" } as any));
    registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] } as any));
    registry.register("hotspot_detect", async () => ([] as any));

    const originalEnabled = process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED;
    const originalMode = process.env.KAIRO_SYMBOLIC_GUARDS_MODE;
    process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED = "true";
    process.env.KAIRO_SYMBOLIC_GUARDS_MODE = "warn";

    const guardSpy = jest.spyOn(SymbolicGuardEngine.prototype, "evaluate");
    guardSpy.mockImplementation(async ({ content }) => {
      const isRisky = String(content).includes("BREAK_GUARD");
      return {
        enabled: true,
        mode: "warn",
        diagnostics: isRisky
          ? [{ code: "index_bounds", severity: "high", message: "guard high" }]
          : [],
        degradedReasons: [],
        stats: { durationMs: 1, queryUsed: true, solverUsed: false }
      };
    });

    const pillar = new ChangePillar(registry) as any;
    pillar.buildCrossLangImpact = jest.fn(async (_targetPath: string, _context: any, options?: any) => {
      if (String(options?.afterContent).includes("BREAK_GUARD")) {
        return {
          packageName: "demo",
          consumerFiles: ["src/consumer.ts"],
          changedExports: ["foo"],
          breakingExports: ["foo"],
          degraded: false
        };
      }
      return {
        packageName: "demo",
        consumerFiles: [],
        changedExports: [],
        degraded: false
      };
    });

    const intent = {
      category: "change",
      action: "modify",
      targets: ["src/a.ts", "src/b.ts"],
      originalIntent: "update demo",
      constraints: {
        dryRun: true,
        includeImpact: true,
        edits: [{ targetString: "OLD_A", replacementString: "BASE_NEW" }],
        strategySearch: {
          mode: "force",
          stage: "r1",
          maxImpactMs: 500,
          candidates: [
            {
              id: "batch-risk",
              edits: [
                { filePath: "src/a.ts", targetString: "OLD_A", replacementString: "BREAK_GUARD" },
                { filePath: "src/b.ts", targetString: "OLD_B", replacementString: "SAFE_B" }
              ]
            },
            {
              id: "batch-safe",
              edits: [
                { filePath: "src/a.ts", targetString: "OLD_A", replacementString: "SAFE_GUARD" },
                { filePath: "src/b.ts", targetString: "OLD_B", replacementString: "SAFE_B" }
              ]
            }
          ]
        }
      },
      confidence: 1
    };

    try {
      const result = await pillar.execute(intent as any, new OrchestrationContext());
      expect(result.success).toBe(true);
      expect(result.strategySearch?.selectedCandidateId).toBe("batch-safe");
      const candidates = Array.isArray(result.strategySearch?.candidates)
        ? result.strategySearch.candidates
        : [];
      const risky = candidates.find((item: any) => item.id === "batch-risk");
      expect(risky?.rewardBreakdown?.penalties?.contract ?? 0).toBeGreaterThan(0);
      expect(risky?.rewardBreakdown?.penalties?.guardsHigh ?? 0).toBeGreaterThan(0);
    } finally {
      guardSpy.mockRestore();
      if (originalEnabled === undefined) {
        delete process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED;
      } else {
        process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED = originalEnabled;
      }
      if (originalMode === undefined) {
        delete process.env.KAIRO_SYMBOLIC_GUARDS_MODE;
      } else {
        process.env.KAIRO_SYMBOLIC_GUARDS_MODE = originalMode;
      }
    }
  });
});
