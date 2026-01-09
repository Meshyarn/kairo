import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { SnapshotBackend } from "../../ast/SnapshotBackend.js";

describe("SnapshotBackend", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-backend-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("fails to initialize when snapshot directory is missing", async () => {
        const backend = new SnapshotBackend({
            snapshotDir: path.join(tempDir, "missing"),
            rootPath: tempDir
        });

        await expect(backend.initialize()).rejects.toThrow("does not exist");
    });

    it("loads snapshot files and falls back to extension language", async () => {
        const rootPath = tempDir;
        const snapshotDir = path.join(tempDir, "snapshots");
        fs.mkdirSync(snapshotDir, { recursive: true });
        const targetPath = path.join(rootPath, "sample.ts");
        const snapshotPath = path.join(snapshotDir, "sample.ts.json");
        fs.writeFileSync(snapshotPath, JSON.stringify({ rootNode: { type: "root" } }), "utf-8");

        const backend = new SnapshotBackend({ snapshotDir, rootPath });
        await backend.initialize();
        const doc = await backend.parseFile(targetPath, "const x = 1;");

        expect(doc.languageId).toBe("ts");
        expect(doc.rootNode).toMatchObject({ type: "root" });
    });
});
