import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, jest } from "@jest/globals";
import { TaskHandlers } from "../../handlers/TaskHandlers.js";
import { createDefaultToolSpecRegistry } from "../../server/tools/ToolSpecRegistry.js";
import { PathManager } from "../../utils/PathManager.js";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { PathNormalizer } from "../../utils/PathNormalizer.js";
import { FileVersionManager } from "../../engine/FileVersionManager.js";

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
        expect(payload.status).toBe("partial_success");
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

    it("runs composite explore→understand when evidence is insufficient", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const exploreResponse = {
            success: true,
            status: "ok",
            data: { docs: [], code: [{ kind: "file_preview", filePath: "src/app.ts", preview: "export const app = 1;" }] },
            pack: { packId: "pack_comp", hit: false, createdAt: Date.now() },
            sessionId: "s-comp"
        };
        const understandResponse = {
            success: true,
            status: "ok",
            summary: "Analysis results for app.",
            primaryFile: "src/app.ts",
            symbols: [],
            dependencies: [],
            sessionId: "s-comp"
        };
        context.orchestrationEngine.executePillar
            .mockResolvedValueOnce(exploreResponse)
            .mockResolvedValueOnce(understandResponse);

        const response = await handler.handle("task", { request: "app details", budget: "balanced", mode: "ask" });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
            1,
            "explore",
            expect.objectContaining({ query: "app details", view: "preview" })
        );
        expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
            2,
            "understand",
            expect.objectContaining({ goal: "app details", targetFiles: ["src/app.ts"] })
        );
        expect(payload.summary.bullets.some((bullet: string) => bullet.startsWith("Deep analysis:"))).toBe(true);
        expect(payload.status).toBe("partial_success");
    });

    it("adds evidence pack for deep ask responses", async () => {
        const flowArtifactManager = { store: jest.fn((artifact: any) => artifact.id) };
        const context = makeContext({ flowArtifactManager });
        const handler = new TaskHandlers(context as any);
        const exploreResponse = {
            success: true,
            status: "ok",
            data: {
                docs: [],
                code: [
                    { kind: "file_preview", filePath: "src/app.ts", preview: "export const app = 1;" },
                    { kind: "file_preview", filePath: "src/utils.ts", preview: "export const util = () => {};" }
                ]
            },
            pack: { packId: "pack_1", hit: false, createdAt: Date.now() },
            sessionId: "s-evidence"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(exploreResponse);

        const response = await handler.handle("task", { request: "find app", budget: "deep" });
        const payload = JSON.parse(response.content[0].text);

        expect(payload.evidence?.length).toBeGreaterThan(0);
        expect(payload.artifacts?.some((artifact: any) => artifact.kind === "evidence")).toBe(true);
        expect(flowArtifactManager.store).toHaveBeenCalled();
        const storedArtifact = (flowArtifactManager.store as jest.Mock).mock.calls[0][0] as any;
        expect(storedArtifact.type).toBe("evidence");
        expect(storedArtifact.sessionId).toBe("s-evidence");
        expect(typeof storedArtifact.expiresAt).toBe("number");
    });

    it("adds evidence pack for deep analyze responses", async () => {
        const flowArtifactManager = { store: jest.fn((artifact: any) => artifact.id) };
        const context = makeContext({ flowArtifactManager });
        const handler = new TaskHandlers(context as any);
        const understandResponse = {
            success: true,
            status: "ok",
            summary: "Analysis results for core.",
            primaryFile: "src/core.ts",
            symbols: [],
            dependencies: [],
            sessionId: "s-evidence-2"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(understandResponse);

        const response = await handler.handle("task", { request: "core analysis", mode: "analyze", budget: "deep" });
        const payload = JSON.parse(response.content[0].text);

        expect(payload.evidence?.length).toBeGreaterThan(0);
        expect(payload.artifacts?.some((artifact: any) => artifact.kind === "evidence")).toBe(true);
        const storedArtifact = (flowArtifactManager.store as jest.Mock).mock.calls[0][0] as any;
        expect(storedArtifact.type).toBe("evidence");
        expect(storedArtifact.sessionId).toBe("s-evidence-2");
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

    it("surfaces targetString candidates in change prep when anchor text is available", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const exploreResponse = {
            success: true,
            status: "ok",
            data: {
                docs: [],
                code: [{ kind: "file_full", filePath: "src/app.ts", content: "export const foo = 1;" }]
            },
            pack: { packId: "pack_targets", hit: false, createdAt: Date.now() },
            sessionId: "s3b"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(exploreResponse);

        const response = await handler.handle("task", { request: "update app", mode: "plan_change", budget: "balanced" });
        const payload = JSON.parse(response.content[0].text);

        expect(payload.changePrep?.targetStringCandidates?.length).toBeGreaterThan(0);
        expect(payload.changePrep?.targetStringCandidates?.[0]?.anchorText).toContain("export const foo");
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

    it("routes write to write pillar with extracted content", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const writeResponse = {
            success: true,
            status: "draft",
            draftPack: { id: "draft_write_1" },
            applyToken: "token_write_1",
            sessionId: "s5w"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(writeResponse);

        const request = "Create file\n```ts\nexport const foo = 1;\n```";
        const response = await handler.handle("task", {
            request,
            mode: "write",
            targetFiles: ["src/foo.ts"]
        });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
            "write",
            expect.objectContaining({
                intent: request,
                targetPath: "src/foo.ts",
                content: "export const foo = 1;",
                safety: "plan"
            })
        );
        expect(payload.draftId).toBe("draft_write_1");
        expect(payload.applyToken).toBe("token_write_1");
        expect(payload.status).toBe("success");
    });

    it("accepts targetPath alias for write", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const writeResponse = {
            success: true,
            status: "draft",
            draftPack: { id: "draft_write_2" },
            sessionId: "s5w2"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(writeResponse);

        const response = await handler.handle("task", {
            request: "Create file",
            mode: "write",
            targetPath: "src/alias.ts"
        });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
            "write",
            expect.objectContaining({ targetPath: "src/alias.ts" })
        );
        expect(payload.draftId).toBe("draft_write_2");
    });

    it("adds prep evidence for write plan without content", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const exploreResponse = {
            success: true,
            status: "ok",
            data: {
                docs: [],
                code: [{ kind: "file_preview", filePath: "src/template.ts", preview: "export const template = 1;" }]
            },
            pack: { packId: "pack_write", hit: false, createdAt: Date.now() },
            sessionId: "s-write"
        };
        const writeResponse = {
            success: true,
            status: "draft",
            draftPack: { id: "draft_write_3" },
            sessionId: "s-write"
        };
        context.orchestrationEngine.executePillar
            .mockResolvedValueOnce(exploreResponse)
            .mockResolvedValueOnce(writeResponse);

        const response = await handler.handle("task", {
            request: "Create component",
            mode: "write",
            budget: "balanced",
            targetFiles: ["src/new.ts"]
        });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
            1,
            "explore",
            expect.objectContaining({ query: "Create component", view: "preview" })
        );
        expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
            2,
            "write",
            expect.objectContaining({ intent: "Create component", targetPath: "src/new.ts", smartWrite: true })
        );
        expect(payload.evidence?.length).toBeGreaterThan(0);
        expect(payload.summary.bullets.some((bullet: string) => bullet.includes("Prep evidence"))).toBe(true);
    });

    it("verifies file content against draft pack", async () => {
        const tempRoot = makeTempRoot();
        const fileSystem = new MemoryFileSystem(tempRoot);
        await fileSystem.writeFile("src/app.ts", "export const bar = 2;");
        const pathNormalizer = new PathNormalizer(tempRoot);
        const fileVersionManager = new FileVersionManager(fileSystem);
        const absPath = pathNormalizer.toAbsolute("src/app.ts");
        const versionInfo = await fileVersionManager.getVersion(absPath);
        const draftPack = {
            id: "draft_verify_1",
            phantomFiles: [{ path: "src/app.ts", content: "export const bar = 2;" }],
            fileVersions: {
                "src/app.ts": {
                    expectedVersion: versionInfo.version,
                    expectedHash: versionInfo.contentHash
                }
            }
        };
        const flowArtifactManager = {
            get: jest.fn(() => ({ type: "draft", pack: draftPack }))
        };
        const context = makeContext({ fileSystem, pathNormalizer, fileVersionManager, flowArtifactManager });
        const handler = new TaskHandlers(context as any);

        const response = await handler.handle("task", {
            request: "verify",
            mode: "verify",
            targetFiles: ["src/app.ts"],
            draftId: "draft_verify_1"
        });
        const payload = JSON.parse(response.content[0].text);

        expect(payload.status).toBe("success");
        expect(payload.verification?.contentMatch).toBe(true);
        expect(payload.verification?.fileVersionMatch).toBeUndefined();
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

    it("auto-verifies apply_change responses when possible", async () => {
        const fileSystem = new MemoryFileSystem();
        await fileSystem.writeFile("src/app.ts", "export const value = 2;\n");
        const draftPack = {
            id: "draft_apply_verify_1",
            phantomFiles: [{ path: "src/app.ts", content: "export const value = 2;\n", isNew: false, language: "ts" }]
        };
        const flowArtifactManager = {
            get: jest.fn((id: string) => (id === "draft_apply_verify_1" ? { type: "draft", pack: draftPack } : undefined))
        };
        const context = makeContext({ fileSystem, flowArtifactManager });
        const handler = new TaskHandlers(context as any);
        const changeResponse = {
            success: true,
            status: "ok",
            targetFile: "src/app.ts",
            sessionId: "s-apply-verify"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(changeResponse);

        const response = await handler.handle("task", {
            request: "apply plan",
            mode: "apply_change",
            budget: "balanced",
            draftId: "draft_apply_verify_1",
            applyToken: "token_1",
            targetFiles: ["src/app.ts"]
        });
        const payload = JSON.parse(response.content[0].text);

        expect(payload.status).toBe("success");
        expect(payload.verification?.contentMatch).toBe(true);
        expect(payload.summary.bullets.some((bullet: string) => bullet.includes("Auto-verify:"))).toBe(true);
    });

    it("auto-verifies write apply responses when possible", async () => {
        const fileSystem = new MemoryFileSystem();
        await fileSystem.writeFile("src/new.ts", "export const generated = 123;\n");
        const draftPack = {
            id: "draft_write_verify_1",
            phantomFiles: [{ path: "src/new.ts", content: "export const generated = 123;\n", isNew: true, language: "ts" }]
        };
        const flowArtifactManager = {
            get: jest.fn((id: string) => (id === "draft_write_verify_1" ? { type: "draft", pack: draftPack } : undefined))
        };
        const context = makeContext({ fileSystem, flowArtifactManager });
        const handler = new TaskHandlers(context as any);
        const writeResponse = {
            success: true,
            status: "ok",
            draftPack: { id: "draft_write_verify_1" },
            sessionId: "s-write-verify"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(writeResponse);

        const response = await handler.handle("task", {
            request: "apply write",
            mode: "write",
            safety: "apply",
            budget: "balanced",
            targetPath: "src/new.ts",
            draftId: "draft_write_verify_1",
            applyToken: "token_write_1"
        });
        const payload = JSON.parse(response.content[0].text);

        expect(payload.status).toBe("success");
        expect(payload.verification?.contentMatch).toBe(true);
        expect(payload.summary.bullets.some((bullet: string) => bullet.includes("Auto-verify:"))).toBe(true);
    });
});
