import { evaluateIntegrityGuardrails } from "../../orchestration/guardrails/IntegrityGuardrails.js";

describe("IntegrityGuardrails", () => {
  it("blocks protocol violations in protected files", async () => {
    const result = await evaluateIntegrityGuardrails({
      targetPath: "src/utils/StdoutGuard.ts",
      oldContent: "export const guard = true;",
      newContent: "console.log('oops');",
      constraints: {
        integrityGuardrails: {
          protocolProtection: {
            files: ["src/utils/StdoutGuard.ts"],
            forbiddenTokens: ["process.stdout", "process.stderr", "console.log"]
          },
          publicSurfaceMonitor: { enabled: false },
          languageParity: { mode: "permissive", fallbackConfidence: "low" }
        }
      }
    });

    expect(result.status).toBe("block");
    expect(result.blockingErrors).toContain("PROTOCOL_POLLUTION_DETECTED");
    expect(result.errorCode).toBe("PROTOCOL_BLOCKED");
  });

  it("warns and returns checklist for core file impact", async () => {
    const dependencyGraph = {
      ensureBuilt: async () => {},
      listAllEdges: () => [
        { from: "src/app.ts", to: "src/core/engine.ts", type: "import" },
        { from: "src/feature.ts", to: "src/core/engine.ts", type: "import" }
      ],
      getDependencies: async (_path: string, direction: "upstream" | "downstream" | "both") => {
        if (direction !== "upstream") return [];
        return Array.from({ length: 12 }, (_, index) => ({
          from: `src/feature_${index}.ts`,
          to: "src/core/engine.ts",
          type: "import"
        }));
      }
    } as any;

    const result = await evaluateIntegrityGuardrails({
      targetPath: "src/core/engine.ts",
      oldContent: "export const engine = {};",
      newContent: "export const engine = { status: 'ok' };",
      dependencyGraph,
      constraints: {
        integrityGuardrails: {
          publicSurfaceMonitor: { enabled: false },
          languageParity: { mode: "permissive", fallbackConfidence: "low" },
          coreProtection: { incomingCountThreshold: 10, blockPolicy: "warn_only" }
        }
      }
    });

    expect(result.status).toBe("warn");
    expect(result.safetyChecklist?.length).toBeGreaterThan(0);
    expect(result.blockingErrors).toContain("CORE_PROTECTION_TRIGGERED");
  });

  it("escalates core protection when index is stale", async () => {
    const dependencyGraph = {
      ensureBuilt: async () => {},
      listAllEdges: () => [
        { from: "src/app.ts", to: "src/core/engine.ts", type: "import" }
      ],
      getDependencies: async (_path: string, direction: "upstream" | "downstream" | "both") => {
        if (direction !== "upstream") return [];
        return Array.from({ length: 12 }, (_, index) => ({
          from: `src/feature_${index}.ts`,
          to: "src/core/engine.ts",
          type: "import"
        }));
      }
    } as any;

    const indexStateManager = {
      getSnapshot: async () => ({
        epoch: 1,
        indexedAt: Date.now(),
        coverageRatio: 0.6,
        staleRisk: "high",
        dirtyFileCount: 120
      })
    } as any;

    const result = await evaluateIntegrityGuardrails({
      targetPath: "src/core/engine.ts",
      oldContent: "export const engine = {};",
      newContent: "export const engine = { status: 'ok' };",
      dependencyGraph,
      indexStateManager,
      applyMode: true,
      constraints: {
        integrityGuardrails: {
          publicSurfaceMonitor: { enabled: false },
          languageParity: { mode: "permissive", fallbackConfidence: "low" },
          coreProtection: { incomingCountThreshold: 10, blockPolicy: "warn_only" }
        }
      }
    });

    expect(result.status).toBe("block");
    expect(result.errorCode).toBe("CORE_PROTECTION_BLOCKED");
    expect(result.blockingErrors).toContain("CORE_PROTECTION_TRIGGERED");
  });

  it("flags stale warning when dirty file count is high", async () => {
    const indexStateManager = {
      getSnapshot: async () => ({
        epoch: 1,
        indexedAt: Date.now(),
        coverageRatio: 0.9,
        staleRisk: "low",
        dirtyFileCount: 150
      })
    } as any;

    const result = await evaluateIntegrityGuardrails({
      targetPath: "src/utils/helper.ts",
      oldContent: "export const helper = () => true;",
      newContent: "export const helper = () => false;",
      indexStateManager,
      constraints: {
        integrityGuardrails: {
          publicSurfaceMonitor: { enabled: false },
          languageParity: { mode: "permissive", fallbackConfidence: "low" }
        }
      }
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "INDEX_STALE_HIGH" })
      ])
    );
  });
});
