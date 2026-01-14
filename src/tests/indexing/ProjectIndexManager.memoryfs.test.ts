import { describe, it, expect } from "@jest/globals";
import path from "path";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { PathManager } from "../../utils/PathManager.js";
import { ProjectIndexManager } from "../../indexing/ProjectIndexManager.js";

describe("ProjectIndexManager (MemoryFileSystem)", () => {
    it("persists and reloads index without disk IO", async () => {
        const rootPath = path.resolve("tmp", `project-index-mem-${Date.now()}`);
        PathManager.setRoot(rootPath);
        const fileSystem = new MemoryFileSystem(rootPath);
        const manager = new ProjectIndexManager(rootPath, fileSystem);

        const index = manager.createEmptyIndex();
        const filePath = path.join(rootPath, "src", "a.ts");
        index.files[filePath] = {
            mtime: Date.now(),
            symbols: [],
            imports: [],
            exports: []
        } as any;

        await manager.persistIndex(index);
        const loaded = await manager.loadPersistedIndex();

        expect(loaded).toBeTruthy();
        expect(loaded?.projectRoot).toBe(rootPath);
        expect(Object.keys(loaded?.files ?? {})).toContain(filePath);
    });
});

