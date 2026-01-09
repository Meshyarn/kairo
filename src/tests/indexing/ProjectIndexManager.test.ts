import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { ProjectIndexManager } from "../../indexing/ProjectIndexManager.js";
import { PathManager } from "../../utils/PathManager.js";
import type { FileIndexEntry, ProjectIndex } from "../../indexing/ProjectIndex.js";

const makeEntry = (mtime: number): FileIndexEntry => ({
    mtime,
    symbols: [],
    imports: [],
    exports: []
});

describe("ProjectIndexManager", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-index-"));
        PathManager.setRoot(tempDir);
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("creates, persists, and reloads indexes", async () => {
        const manager = new ProjectIndexManager(tempDir);
        const index = manager.createEmptyIndex();
        const filePath = path.join(tempDir, "a.ts");
        fs.writeFileSync(filePath, "export const a = 1;");
        index.files[filePath] = makeEntry(Date.now());

        await manager.persistIndex(index);
        const loaded = await manager.loadPersistedIndex();
        expect(loaded?.projectRoot).toBe(tempDir);
        expect(Object.keys(loaded?.files ?? {})).toContain(filePath);
    });

    it("detects changed files and handles version mismatch", async () => {
        const manager = new ProjectIndexManager(tempDir);
        const fileA = path.join(tempDir, "a.ts");
        const fileB = path.join(tempDir, "b.ts");
        fs.writeFileSync(fileA, "export const a = 1;");
        fs.writeFileSync(fileB, "export const b = 2;");
        const statA = fs.statSync(fileA);
        const statB = fs.statSync(fileB);

        const index: ProjectIndex = {
            version: "1.1.0",
            projectRoot: tempDir,
            lastUpdate: Date.now(),
            files: {
                [fileA]: makeEntry(statA.mtimeMs - 1000),
                [fileB]: makeEntry(statB.mtimeMs + 1000)
            },
            symbolIndex: {},
            reverseImports: {}
        };
        await manager.persistIndex(index);
        const changed = await manager.getChangedFilesSinceLastIndex([fileA, fileB]);
        expect(changed.changed).toContain(fileA);
        expect(changed.unchanged).toContain(fileB);

        const mismatch: ProjectIndex = { ...index, version: "0.0.1" };
        await manager.persistIndex(mismatch);
        const loaded = await manager.loadPersistedIndex();
        expect(loaded).toBeNull();
    });
});
