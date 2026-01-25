import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, jest } from "@jest/globals";
import { TaskHandlers } from "../../handlers/TaskHandlers.js";
import { createDefaultToolSpecRegistry } from "../../server/tools/ToolSpecRegistry.js";
import { PathManager } from "../../utils/PathManager.js";

const makeContext = (overrides: Record<string, unknown> = {}) => {
    const executePillar = jest.fn<(...args: any[]) => Promise<any>>();
    return {
        rootPath: process.cwd(),
        orchestrationEngine: { executePillar },
        toolSpecRegistry: createDefaultToolSpecRegistry(),
        indexStateManager: { getDirtyFiles: jest.fn(() => []) },
        isTestEnv: () => true,
        ...overrides
    };
};

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "kairo-task-"));

const writeMcpConfig = (root: string, payload: Record<string, unknown>) => {
    const configDir = path.join(root, ".kairo", "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "mcp.json"), JSON.stringify(payload, null, 2));
};

describe("TaskHandlers", () => {
    it("routes ask to explore and returns summary", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const exploreResponse = {
            success: true,
            status: "ok",
            data: { docs: [], code: [{ kind: "file_preview", filePath: "src/app.ts" }] },
            pack: { packId: "pack_1", hit: false, createdAt: Date.now() },
            sessionId: "s1"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(exploreResponse);

        const response = await handler.handle("task", { request: "find app" });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
            "explore",
            expect.objectContaining({ query: "find app", profile: "lean", view: "preview" })
        );
        expect(payload.summary.title).toContain("find app");
        expect(payload.packId).toBe("pack_1");
        expect(payload.status).toBe("success");
    });

    it("routes analyze to understand and returns summary", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const understandResponse = {
            success: true,
            status: "ok",
            summary: "Analysis results for \"core\".",
            primaryFile: "src/core.ts",
            symbols: [],
            dependencies: [],
            sessionId: "s2"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(understandResponse);

        const response = await handler.handle("task", { request: "core structure", mode: "analyze" });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
            "understand",
            expect.objectContaining({ goal: "core structure", profile: "lean" })
        );
        expect(payload.summary.title).toContain("core structure");
        expect(payload.status).toBe("success");
    });

    it("returns change prep when plan_change has no edits", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const exploreResponse = {
            success: true,
            status: "ok",
            data: { docs: [], code: [{ kind: "file_preview", filePath: "src/app.ts" }] },
            pack: { packId: "pack_2", hit: false, createdAt: Date.now() },
            sessionId: "s3"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(exploreResponse);

        const response = await handler.handle("task", { request: "update app", mode: "plan_change" });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
            "explore",
            expect.objectContaining({ query: "update app", view: "preview" })
        );
        expect(payload.status).toBe("partial_success");
        expect(payload.changePrep?.recommendedTargets).toContain("src/app.ts");
        expect(payload.packId).toBe("pack_2");
    });

    it("routes plan_change with edits to change plan", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const changeResponse = {
            success: true,
            status: "ok",
            draftPack: { id: "draft_1", intent: "update", status: "pending", createdAt: Date.now() },
            applyToken: "token_1",
            sessionId: "s4"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(changeResponse);

        const response = await handler.handle("task", {
            request: "update app",
            mode: "plan_change",
            edits: [{ targetString: "old", replacementString: "new" }],
            targetFiles: ["src/app.ts"]
        });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
            "change",
            expect.objectContaining({ intent: "update app", safety: "plan" })
        );
        expect(payload.draftId).toBe("draft_1");
        expect(payload.applyToken).toBe("token_1");
        expect(payload.status).toBe("success");
    });

    it("routes apply_change to change apply with token", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const changeResponse = {
            success: true,
            status: "ok",
            review: { id: "review_1" },
            sessionId: "s5"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(changeResponse);

        const response = await handler.handle("task", {
            request: "apply plan",
            mode: "apply_change",
            draftId: "draft_1",
            applyToken: "token_1"
        });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
            "change",
            expect.objectContaining({ intent: "apply plan", safety: "apply", draftId: "draft_1", applyToken: "token_1" })
        );
        expect(payload.status).toBe("success");
    });

    it("auto-repairs file version mismatch with preview refresh", async () => {
        const originalRoot = process.cwd();
        const tempRoot = makeTempRoot();
        PathManager.setRoot(tempRoot);
        writeMcpConfig(tempRoot, {
            mode: "mcp",
            autopilot: {
                maxAutoRepairAttempts: 1,
                allowAutoReindex: false
            }
        });
        const context = makeContext({ rootPath: tempRoot });
        const handler = new TaskHandlers(context as any);
        const changeResponse = {
            success: false,
            status: "blocked",
            blockedReason: "file_version_mismatch",
            degradedReasons: [{ type: "degraded", message: "file_version_mismatch", filePath: "src/app.ts" }],
            sessionId: "s6"
        };
        const exploreResponse = {
            success: true,
            status: "ok",
            data: { docs: [], code: [] },
            pack: { packId: "pack_3", hit: false, createdAt: Date.now() },
            sessionId: "s6"
        };
        context.orchestrationEngine.executePillar
            .mockResolvedValueOnce(changeResponse)
            .mockResolvedValueOnce(exploreResponse);

        try {
            const response = await handler.handle("task", {
                request: "apply plan",
                mode: "apply_change",
                budget: "lean"
            });
            const payload = JSON.parse(response.content[0].text);

            expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
                1,
                "change",
                expect.objectContaining({ intent: "apply plan", safety: "apply" })
            );
            expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
                2,
                "explore",
                expect.objectContaining({ paths: ["src/app.ts"], view: "preview", sessionId: "s6" })
            );
            expect(payload.autoRepair?.attempts?.[0]?.tool).toBe("explore");
            expect(payload.autoRepair?.attempts?.[0]?.packId).toBe("pack_3");
        } finally {
            PathManager.setRoot(originalRoot);
        }
    });

    it("auto-repairs stale index with path reindex", async () => {
        const originalRoot = process.cwd();
        const tempRoot = makeTempRoot();
        PathManager.setRoot(tempRoot);
        writeMcpConfig(tempRoot, {
            mode: "mcp",
            autopilot: {
                maxAutoRepairAttempts: 1,
                allowAutoReindex: true
            }
        });
        const indexStateManager = { getDirtyFiles: jest.fn(() => ["src/a.ts", "src/b.ts"]) };
        const context = makeContext({ indexStateManager, rootPath: tempRoot });
        const handler = new TaskHandlers(context as any);
        const changeResponse = {
            success: false,
            status: "blocked",
            blockedReason: "index_stale_high",
            indexSnapshot: { dirtyFileCount: 2 },
            sessionId: "s7"
        };
        const manageResponse = {
            success: true,
            output: "Reindex enqueued (paths).",
            scope: "paths",
            paths: ["src/a.ts", "src/b.ts"]
        };
        context.orchestrationEngine.executePillar
            .mockResolvedValueOnce(changeResponse)
            .mockResolvedValueOnce(manageResponse);

        try {
            const response = await handler.handle("task", {
                request: "apply plan",
                mode: "apply_change",
                budget: "lean"
            });
            const payload = JSON.parse(response.content[0].text);

            expect(indexStateManager.getDirtyFiles).toHaveBeenCalled();
            expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
                2,
                "manage",
                expect.objectContaining({ command: "reindex", paths: ["src/a.ts", "src/b.ts"] })
            );
            expect(payload.autoRepair?.attempts?.[0]?.tool).toBe("manage");
        } finally {
            PathManager.setRoot(originalRoot);
        }
    });
});
