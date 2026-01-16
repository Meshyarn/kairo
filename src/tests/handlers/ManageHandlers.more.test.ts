import { describe, it, expect, jest } from "@jest/globals";
import { ManageHandlers } from "../../handlers/ManageHandlers.js";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { FeatureFlags } from "../../config/FeatureFlags.js";
import { createDefaultToolSpecRegistry } from "../../server/tools/ToolSpecRegistry.js";

const makeContext = () => {
    return {
        rootPath: process.cwd(),
        orchestrationEngine: { executePillar: jest.fn(async () => ({ ok: true })) },
        fileSystem: new MemoryFileSystem(process.cwd()),
        editCoordinator: {
            undo: jest.fn(async () => ({ success: true, message: "undo" })),
            redo: jest.fn(async () => ({ success: true, message: "redo" })),
            getTransactionLog: jest.fn(() => ({
                getPendingTransactions: () => [{ id: "t1", timestamp: Date.now(), status: "pending", description: "pending", snapshots: [] }],
                listTransactions: () => [{ id: "c1", timestamp: Date.now(), status: "committed", description: "commit", snapshots: [] }]
            }))
        },
        dependencyGraph: {
            ensureBuilt: jest.fn(async () => undefined),
            getIndexStatus: jest.fn(async () => ({
                global: { totalFiles: 1, indexedFiles: 1, unresolvedImports: 0, confidence: "high" },
                perFile: { "src/file.ts": { resolved: false, unresolvedImports: ["x"] } }
            })),
            setLoggingEnabled: jest.fn()
        },
        indexStateManager: {
            updateTotals: jest.fn(),
            getSnapshot: jest.fn(async () => ({
                epoch: 1,
                indexedAt: Date.now(),
                coverageRatio: 1,
                staleRisk: "low",
                dirtyFileCount: 0
            })),
            getActivity: jest.fn(() => undefined),
            markReindexStart: jest.fn(),
            markReindexComplete: jest.fn(),
            markReindexFailed: jest.fn()
        },
        documentSearchEngine: {
            getEmbeddingStatus: jest.fn(async () => ({ available: true }))
        },
        indexDatabase: {
            listFiles: jest.fn(() => [])
        },
        skeletonCache: { clearAll: jest.fn(async () => undefined) },
        searchEngine: { rebuild: jest.fn(async () => undefined) },
        documentIndexer: { rebuildAll: jest.fn(async () => undefined) },
        historyEngine: { getHistory: jest.fn(async () => ({ undoStack: [], redoStack: [] })) },
        impactAnalyzer: { analyzeImpact: jest.fn(async () => ({ suggestedTests: ["a.test.ts"] })) },
        pathNormalizer: {
            normalize: (value: string) => value,
            toAbsolute: (value: string) => `/abs/${value}`
        },
        toolSpecRegistry: createDefaultToolSpecRegistry(),
        isTestEnv: () => true
    };
};

describe("ManageHandlers additional paths", () => {
    it("handles project_manage status and history commands", async () => {
        const context = makeContext();
        const handler = new ManageHandlers(context as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);

        const status = await FeatureFlags.withContext({ userId: "test-user" }, () =>
            raw({ command: "status", suppressLogs: true })
        );
        expect(status.success).toBe(true);
        expect(status.status.unresolvedSample).toHaveLength(1);
        expect(status.indexSnapshot).toBeDefined();
        expect(status.capabilityDiagnostics).toBeDefined();
        expect(status.rollout).toBeDefined();
        expect(status.rollout.preset).toBeDefined();
        expect(status.rollout.userIdResolved).toBe(true);
        expect(status.rollout.userIdHash).toBeDefined();
        expect(status.rollout.flags).toBeDefined();
        expect(status.rollout.modes).toBeDefined();
        expect(status.rollout.adaptiveFlow).toBeDefined();
        expect(status.rollout.cohort).toBeDefined();
        expect(status.rollout.cohort.betaPercent).toBeDefined();
        expect(status.rollout.cohort.canaryUserCount).toBeDefined();
        expect(status.rollout.adaptiveFlow.metrics).toBeDefined();
        expect(status.rollout.adaptiveFlow.alertThresholds).toBeDefined();

        const history = await raw({ command: "history" });
        expect(history.history.pendingTransactions[0]?.id).toBe("t1");
        expect(history.history.checkpoints[0]?.id).toBe("c1");
    });

    it("handles metrics, config, and reindex commands", async () => {
        const context = makeContext();
        const handler = new ManageHandlers(context as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);

        const metrics = await raw({ command: "metrics" });
        expect(metrics.success).toBe(true);

        const reset = await raw({ command: "metrics_reset" });
        expect(reset.output).toContain("Metrics reset");

        const config = await raw({ command: "config" });
        expect(config.config.embedding.provider).toBeDefined();

        const symbolStatus = await raw({ command: "symbol_index_status" });
        expect(symbolStatus.success).toBe(true);
        expect(symbolStatus.status).toBeDefined();

        const reindex = await raw({ command: "reindex", suppressLogs: true });
        expect(reindex.success).toBe(true);
        expect(context.skeletonCache.clearAll).toHaveBeenCalled();
    });

    it("handles test command errors and resolves targets", async () => {
        const context = makeContext();
        const handler = new ManageHandlers(context as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);

        const missing = await raw({ command: "test" });
        expect(missing.success).toBe(false);

        const provided = await raw({ command: "test", target: "src/file.ts" });
        expect(provided.suggestedTests).toContain("a.test.ts");
    });
});
