import { describe, it, expect } from "@jest/globals";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { FlowArtifactManager } from "../../orchestration/flow-artifact-manager.js";

describe("FlowArtifactManager", () => {
    it("stores, persists, and restores artifacts", async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kairo-artifacts-"));
        try {
            const manager = new FlowArtifactManager({ persistPath: tempDir });
            const artifact = manager.store({
                id: "rp_test",
                type: "research",
                createdAt: Date.now(),
                pack: {
                    id: "rp_test",
                    sketch: { summary: "ok", topModules: [], edgesSample: [] },
                    createdAt: Date.now()
                }
            } as any);
            expect(artifact).toBe("rp_test");

            const filePath = await manager.persist("rp_test", manager.get("rp_test") as any);
            expect(filePath).toContain("rp_test.json");

            manager.discard("rp_test");
            const restored = await manager.importFromPath(filePath);
            expect(restored?.id).toBe("rp_test");
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it("creates and updates sessions when artifacts are stored", async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kairo-artifacts-"));
        try {
            const manager = new FlowArtifactManager({ persistPath: tempDir, autoPersist: true });
            const sessionId = manager.resolveSessionId("new", "Session intent");
            expect(sessionId).toBeDefined();

            manager.store({
                id: "style_test",
                type: "style",
                createdAt: Date.now(),
                pack: { id: "style_test", profile: { codeStyle: { indent: "spaces", indentSize: 2, quotes: "single", semicolons: true, lineEndings: "lf" }, patterns: { imports: [], naming: [], fileOrg: { fileNamePattern: "", directoryPattern: "" } }, confidence: "low" }, scope: "**/*", createdAt: Date.now() },
                sessionId,
                metadata: { intent: "Session intent" }
            } as any);

            const session = manager.getSession(sessionId as string);
            expect(session?.artifacts.style).toBe("style_test");

            manager.discard("style_test");
            const afterDiscard = manager.getSession(sessionId as string);
            expect(afterDiscard?.artifacts.style).toBeUndefined();

            const sessionPath = await manager.persistSession(afterDiscard as any);
            expect(sessionPath).toContain("sessions");
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it("returns the latest StylePack for a session", async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kairo-artifacts-"));
        try {
            const manager = new FlowArtifactManager({ persistPath: tempDir });
            const sessionId = manager.resolveSessionId("new", "Style session");
            const firstCreated = Date.now() - 1000;
            manager.store({
                id: "style_old",
                type: "style",
                createdAt: firstCreated,
                pack: { id: "style_old", profile: { codeStyle: { indent: "spaces", indentSize: 2, quotes: "single", semicolons: true, lineEndings: "lf" }, patterns: { imports: [], naming: [], fileOrg: { fileNamePattern: "", directoryPattern: "" } }, confidence: "low" }, scope: "**/*", createdAt: firstCreated },
                sessionId
            } as any);
            manager.store({
                id: "style_new",
                type: "style",
                createdAt: Date.now(),
                pack: { id: "style_new", profile: { codeStyle: { indent: "tabs", indentSize: 1, quotes: "double", semicolons: false, lineEndings: "lf" }, patterns: { imports: [], naming: [], fileOrg: { fileNamePattern: "", directoryPattern: "" } }, confidence: "low" }, scope: "**/*", createdAt: Date.now() },
                sessionId
            } as any);

            const latest = manager.getLatestStylePack(sessionId as string);
            expect(latest?.id).toBe("style_new");
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
