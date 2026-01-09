import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { MemoryFileSystem, NodeFileSystem } from "../../platform/FileSystem.js";

describe("NodeFileSystem", () => {
    let tempDir: string;
    let fileSystem: NodeFileSystem;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-fs-"));
        fileSystem = new NodeFileSystem(tempDir);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("writes, reads, renames, and deletes files", async () => {
        await fileSystem.createDir("docs");
        await fileSystem.writeFile("docs/a.txt", "hello");
        await expect(fileSystem.readFile("docs/a.txt")).resolves.toBe("hello");

        await fileSystem.rename("docs/a.txt", "docs/b.txt");
        await expect(fileSystem.exists("docs/b.txt")).resolves.toBe(true);

        await fileSystem.deleteFile("docs/b.txt");
        await expect(fileSystem.exists("docs/b.txt")).resolves.toBe(false);
    });

    it("removes directories when deleteFile hits EISDIR", async () => {
        await fileSystem.createDir("logs");
        await fileSystem.writeFile("logs/app.log", "line");
        await fileSystem.deleteFile("logs");
        expect(fs.existsSync(path.join(tempDir, "logs"))).toBe(false);
    });

    it("lists files recursively", async () => {
        await fileSystem.createDir("nested/inner");
        await fileSystem.writeFile("nested/a.txt", "a");
        await fileSystem.writeFile("nested/inner/b.txt", "b");

        const files = await fileSystem.listFiles(tempDir);
        const relative = files.map(file => path.relative(tempDir, file).split(path.sep).join("/"));
        expect(relative).toEqual(expect.arrayContaining(["nested/a.txt", "nested/inner/b.txt"]));
    });

    it("reports stats for files and directories", async () => {
        await fileSystem.writeFile("stat.txt", "1234");
        const fileStat = await fileSystem.stat("stat.txt");
        expect(fileStat.size).toBe(4);
        expect(fileStat.isDirectory()).toBe(false);

        await fileSystem.createDir("dir");
        const dirStat = await fileSystem.stat("dir");
        expect(dirStat.isDirectory()).toBe(true);
    });
});

describe("MemoryFileSystem", () => {
    let fileSystem: MemoryFileSystem;

    beforeEach(() => {
        fileSystem = new MemoryFileSystem("/mem-root");
    });

    it("handles basic file operations", async () => {
        await fileSystem.createDir("docs");
        await fileSystem.writeFile("docs/readme.md", "hello");

        await expect(fileSystem.readFile("docs/readme.md")).resolves.toBe("hello");
        await expect(fileSystem.exists("docs/readme.md")).resolves.toBe(true);

        await fileSystem.rename("docs/readme.md", "docs/guide.md");
        await expect(fileSystem.exists("docs/guide.md")).resolves.toBe(true);

        await fileSystem.deleteFile("docs/guide.md");
        await expect(fileSystem.exists("docs/guide.md")).resolves.toBe(false);
    });

    it("lists directory entries and stats", async () => {
        await fileSystem.writeFile("docs/a.txt", "a");
        await fileSystem.writeFile("docs/b.txt", "b");
        await fileSystem.createDir("docs/sub");

        const entries = await fileSystem.readDir("docs");
        expect(entries).toEqual(expect.arrayContaining(["a.txt", "b.txt", "sub"]));

        const stats = await fileSystem.stat("docs");
        expect(stats.isDirectory()).toBe(true);
    });

    it("notifies watchers on changes", async () => {
        const events: string[] = [];
        const stop = fileSystem.watch("/mem-root", (event) => {
            events.push(`${event.type}:${path.basename(event.path)}`);
        });

        await fileSystem.writeFile("watch.txt", "a");
        await fileSystem.writeFile("watch.txt", "b");
        await fileSystem.deleteFile("watch.txt");
        stop();

        expect(events).toEqual(expect.arrayContaining(["create:watch.txt", "update:watch.txt", "delete:watch.txt"]));
    });

    it("throws when reading missing directory", async () => {
        await expect(fileSystem.readDir("missing")).rejects.toThrow("ENOENT");
    });

    it("collects files recursively", async () => {
        await fileSystem.writeFile("src/index.ts", "content");
        await fileSystem.writeFile("src/nested/util.ts", "content");
        const files = await fileSystem.listFiles("/mem-root");
        const relative = files.map(file => path.relative("/mem-root", file).split(path.sep).join("/"));
        expect(relative).toEqual(expect.arrayContaining(["src/index.ts", "src/nested/util.ts"]));
    });
});
