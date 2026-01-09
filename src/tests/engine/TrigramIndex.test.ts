import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { MemoryFileSystem, NodeFileSystem } from "../../platform/FileSystem.js";
import { PathManager } from "../../utils/PathManager.js";
import { TrigramIndex } from "../../engine/TrigramIndex.js";

describe("TrigramIndex", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trigram-index-"));
        PathManager.setRoot(tempDir);
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("indexes files and supports trigram and substring searches", async () => {
        const fileSystem = new MemoryFileSystem(tempDir);
        await fileSystem.writeFile("docs/hello.txt", "Hello world");
        await fileSystem.writeFile("docs/other.txt", "Other content");

        const index = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt"],
            maxFileBytes: 1024
        });
        await index.ensureReady();

        const results = await index.search("hello");
        expect(results.map(entry => entry.filePath)).toContain("docs/hello.txt");

        const shortResults = await index.search("he");
        expect(shortResults.map(entry => entry.filePath)).toContain("docs/hello.txt");
    });

    it("refreshes and removes files when content changes", async () => {
        const fileSystem = new MemoryFileSystem(tempDir);
        await fileSystem.writeFile("docs/a.txt", "First content");

        const index = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt", ".log"],
            maxFileBytes: 1024
        });
        await index.ensureReady();

        await fileSystem.writeFile("docs/a.txt", "Zebra content");
        await index.refreshFile(path.join(tempDir, "docs/a.txt"));

        const refreshed = await index.search("zebra");
        expect(refreshed.map(entry => entry.filePath)).toContain("docs/a.txt");

        await index.removeFile(path.join(tempDir, "docs/a.txt"));
        const removed = await index.search("zebra");
        expect(removed).toHaveLength(0);
    });

    it("updates ignore globs and omits ignored files", async () => {
        const fileSystem = new MemoryFileSystem(tempDir);
        await fileSystem.writeFile("docs/keep.txt", "Keep");
        await fileSystem.writeFile("docs/skip.log", "Skip");

        const index = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt", ".log"],
            maxFileBytes: 1024
        });
        await index.ensureReady();
        expect(index.listFiles()).toEqual(expect.arrayContaining(["docs/keep.txt", "docs/skip.log"]));

        await index.updateIgnoreGlobs(["docs/skip.log"]);
        expect(index.listFiles()).toEqual(expect.arrayContaining(["docs/keep.txt"]));
        expect(index.listFiles()).not.toEqual(expect.arrayContaining(["docs/skip.log"]));
    });

    it("persists and reloads the index", async () => {
        const fileSystem = new NodeFileSystem(tempDir);
        await fileSystem.createDir("docs");
        await fileSystem.writeFile("docs/a.txt", "alpha beta");

        const index = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt"],
            maxFileBytes: 1024
        });
        await index.ensureReady();
        await (index as any).persistIndex();

        const reloaded = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt"],
            maxFileBytes: 1024
        });
        await reloaded.ensureReady();
        expect(reloaded.listFiles()).toContain("docs/a.txt");
    });

    it("applies document frequency filters and per-file term caps", async () => {
        const fileSystem = new MemoryFileSystem(tempDir);
        await fileSystem.writeFile("docs/a.txt", "common common");
        await fileSystem.writeFile("docs/b.txt", "common common");

        const index = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt"],
            maxFileBytes: 1024,
            maxDocFreq: 0.4,
            maxTermsPerFile: 1
        });
        await index.ensureReady();
        const matches = await index.search("common", 10, { waitForReady: true });
        expect(matches).toHaveLength(0);

        const entry = (index as any).fileEntries.get("docs/a.txt");
        expect(entry.trigramFreq.size).toBeLessThanOrEqual(1);
    });

    it("returns empty results when disabled", async () => {
        const fileSystem = new MemoryFileSystem(tempDir);
        const index = new TrigramIndex(tempDir, fileSystem, { enabled: false });
        await index.ensureReady();
        expect(await index.search("anything")).toEqual([]);
        expect(index.listFiles()).toEqual([]);
    });

    it("returns empty results before readiness when waitForReady is false", async () => {
        const fileSystem = new MemoryFileSystem(tempDir);
        await fileSystem.writeFile("docs/a.txt", "alpha");

        const index = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt"]
        });

        const results = await index.search("alpha");
        expect(results).toEqual([]);
    });

    it("refreshes directories to pick up new files", async () => {
        const fileSystem = new MemoryFileSystem(tempDir);
        await fileSystem.writeFile("docs/one.txt", "one");

        const index = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt"]
        });
        await index.ensureReady();

        await fileSystem.writeFile("docs/new.txt", "new");
        await index.refreshDirectory(path.join(tempDir, "docs"));

        expect(index.listFiles()).toContain("docs/new.txt");
    });

    it("drops corrupt persisted index files", async () => {
        const fileSystem = new NodeFileSystem(tempDir);
        await fileSystem.createDir("docs");
        await fileSystem.writeFile("docs/a.txt", "alpha");

        const persistPath = path.join(PathManager.getIndexDir(), "trigram-index.json");
        fs.mkdirSync(path.dirname(persistPath), { recursive: true });
        fs.writeFileSync(persistPath, "{bad json");

        const index = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt"]
        });
        await index.ensureReady();

        expect(fs.existsSync(persistPath)).toBe(false);
        await index.dispose();
    });

    it("rebuilds with progress logging enabled", async () => {
        const fileSystem = new MemoryFileSystem(tempDir);
        await fileSystem.writeFile("docs/a.txt", "alpha");
        await fileSystem.writeFile("docs/b.txt", "bravo");

        const index = new TrigramIndex(tempDir, fileSystem, {
            includeExtensions: [".txt"]
        });

        const logger = jest.fn();
        await index.rebuild({ logTotals: true, logger, logEvery: 1 });
        expect(logger).toHaveBeenCalled();
        await index.dispose();
    });
});
