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
});
