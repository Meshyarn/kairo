import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { IncrementalIndexer } from "../../indexing/IncrementalIndexer.js";
import { PathManager } from "../../utils/PathManager.js";

describe("IncrementalIndexer additional flows", () => {
    let tempDir: string;
    let currentIndexer: any;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-more-"));
        tempDir = fs.realpathSync(tempDir);
        PathManager.setRoot(tempDir);
    });

    afterEach(async () => {
        if (currentIndexer) {
            await currentIndexer.stop();
            currentIndexer = undefined;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const createIndexer = (overrides?: {
        symbolIndex?: any;
        dependencyGraph?: any;
        indexDatabase?: any;
        documentIndexer?: any;
        nativeSearchIndexer?: any;
        repoId?: string;
    }) => {
        const symbolIndex = overrides?.symbolIndex ?? {
            isSupported: jest.fn(() => true),
            shouldIgnore: jest.fn((rel: string) => rel.includes("ignored.ts")),
            getSymbolsForFile: jest.fn(async () => []),
            restoreFromCache: jest.fn(),
            findFilesBySymbolName: jest.fn(async () => [])
        };

        const dependencyGraph = overrides?.dependencyGraph ?? {
            removeFile: jest.fn(async () => undefined),
            removeDirectory: jest.fn(async () => undefined),
            rebuildUnresolved: jest.fn(async () => undefined),
            updateFileDependencies: jest.fn(async () => undefined),
            restoreEdges: jest.fn(async () => undefined)
        };

        const indexDatabase = overrides?.indexDatabase ?? {
            listFiles: jest.fn(() => []),
            deleteFile: jest.fn(),
            getFile: jest.fn(() => undefined),
            readSymbols: jest.fn(() => []),
            addGhost: jest.fn()
        };

        const indexer = new IncrementalIndexer(
            tempDir,
            symbolIndex,
            dependencyGraph,
            indexDatabase,
            undefined,
            undefined,
            {
                watch: false,
                initialScan: false,
                nativeSearchIndexer: overrides?.nativeSearchIndexer,
                repoId: overrides?.repoId ?? "default"
            },
            overrides?.documentIndexer
        );

        return { indexer, symbolIndex, dependencyGraph, indexDatabase };
    };

    it("handles gitignore changes by removing ignored files and enqueuing new ones", async () => {
        const keepFile = path.join(tempDir, "keep.ts");
        const ignoredFile = path.join(tempDir, "ignored.ts");
        const newFile = path.join(tempDir, "new.ts");
        fs.writeFileSync(keepFile, "export const keep = true;");
        fs.writeFileSync(ignoredFile, "export const ignored = true;");
        fs.writeFileSync(newFile, "export const fresh = true;");

        const indexDatabase = {
            listFiles: jest.fn(() => [{ path: "keep.ts" }, { path: "ignored.ts" }]),
            deleteFile: jest.fn(),
            getFile: jest.fn((rel: string) => (rel === "new.ts" ? undefined : { path: rel })),
            readSymbols: jest.fn(() => []),
            addGhost: jest.fn()
        };

        const { indexer, symbolIndex } = createIndexer({ indexDatabase });
        currentIndexer = indexer;
        symbolIndex.shouldIgnore = jest.fn((rel: string) => rel.includes("ignored.ts"));

        const enqueueSpy = jest.spyOn(indexer as any, "enqueuePath");
        await (indexer as any).handleIgnoreChange();

        expect(indexDatabase.deleteFile).toHaveBeenCalledWith("ignored.ts");
        expect(enqueueSpy).toHaveBeenCalledWith(newFile, "high");
    });

    it("registers ghosts and clears queues on deletion", async () => {
        const docPath = path.join(tempDir, "doc.md");
        fs.writeFileSync(docPath, "# Title\n");

        const documentIndexer = {
            isSupported: jest.fn(() => true),
            deleteFile: jest.fn(),
            indexFile: jest.fn()
        };

        const symbolIndex = {
            isSupported: jest.fn(() => true),
            shouldIgnore: jest.fn(() => false),
            getSymbolsForFile: jest.fn(async () => []),
            restoreFromCache: jest.fn(),
            findFilesBySymbolName: jest.fn(async () => [])
        };

        const indexDatabase = {
            listFiles: jest.fn(() => []),
            deleteFile: jest.fn(),
            getFile: jest.fn(() => undefined),
            readSymbols: jest.fn(() => [
                {
                    name: "OldSymbol",
                    type: "class",
                    signature: "sig()",
                    range: { startLine: 1, endLine: 1, startByte: 0, endByte: 1 }
                }
            ]),
            addGhost: jest.fn()
        };

        const dependencyGraph = {
            removeFile: jest.fn(async () => undefined),
            removeDirectory: jest.fn(async () => undefined),
            rebuildUnresolved: jest.fn(async () => undefined),
            updateFileDependencies: jest.fn(async () => undefined),
            restoreEdges: jest.fn(async () => undefined)
        };

        const { indexer } = createIndexer({
            symbolIndex,
            indexDatabase,
            dependencyGraph,
            documentIndexer
        });
        currentIndexer = indexer;

        (indexer as any).enqueuePath(docPath, "high");

        const indexManager = (indexer as any).indexManager;
        const currentIndex = indexManager.createEmptyIndex();
        currentIndex.files[docPath] = {
            mtime: Date.now(),
            symbols: [{ name: "OldSymbol", type: "class", range: { startLine: 1, endLine: 1, startByte: 0, endByte: 1 } }],
            imports: [],
            exports: []
        };
        currentIndex.symbolIndex["OldSymbol"] = [docPath];
        (indexer as any).currentIndex = currentIndex;

        await (indexer as any).handleDeletion(docPath);

        expect(documentIndexer.deleteFile).toHaveBeenCalledWith(docPath);
        expect(indexDatabase.addGhost).toHaveBeenCalledWith(expect.objectContaining({
            name: "OldSymbol",
            lastKnownSignature: "sig()"
        }));
        expect(dependencyGraph.removeFile).toHaveBeenCalledWith(docPath);
        expect(indexer.getActivitySnapshot().queueDepth.total).toBe(0);
    });

    it("removes queued entries when a directory is deleted", async () => {
        const dirPath = path.join(tempDir, "src");
        fs.mkdirSync(dirPath, { recursive: true });
        const fileA = path.join(dirPath, "a.ts");
        const fileB = path.join(dirPath, "b.ts");
        fs.writeFileSync(fileA, "export const a = 1;");
        fs.writeFileSync(fileB, "export const b = 2;");

        const dependencyGraph = {
            removeFile: jest.fn(async () => undefined),
            removeDirectory: jest.fn(async () => undefined),
            rebuildUnresolved: jest.fn(async () => undefined),
            updateFileDependencies: jest.fn(async () => undefined),
            restoreEdges: jest.fn(async () => undefined)
        };

        const { indexer } = createIndexer({ dependencyGraph });
        currentIndexer = indexer;
        (indexer as any).enqueuePath(fileA, "high");
        (indexer as any).enqueuePath(fileB, "low");

        await (indexer as any).handleDirectoryDeletion(dirPath);

        expect(dependencyGraph.removeDirectory).toHaveBeenCalledWith(dirPath);
        expect(indexer.getActivitySnapshot().queueDepth.total).toBe(0);
    });

    it("cleans persisted indices when a directory is deleted", async () => {
        const dirPath = path.join(tempDir, "src");
        fs.mkdirSync(dirPath, { recursive: true });
        const docPath = path.join(dirPath, "doc.md");
        const codePath = path.join(dirPath, "a.ts");
        fs.writeFileSync(docPath, "# Title\n");
        fs.writeFileSync(codePath, "export const a = 1;");

        const dependencyGraph = {
            removeFile: jest.fn(async () => undefined),
            removeDirectory: jest.fn(async () => undefined),
            rebuildUnresolved: jest.fn(async () => undefined),
            updateFileDependencies: jest.fn(async () => undefined),
            restoreEdges: jest.fn(async () => undefined)
        };

        const indexDatabase = {
            listFiles: jest.fn(() => [
                { path: "src/a.ts" },
                { path: "src/doc.md" },
                { path: "other.ts" }
            ]),
            deleteFile: jest.fn(),
            getFile: jest.fn(() => undefined),
            readSymbols: jest.fn(() => []),
            addGhost: jest.fn()
        };

        const documentIndexer = {
            isSupported: jest.fn((filePath: string) => filePath.endsWith(".md")),
            deleteFile: jest.fn(),
            indexFile: jest.fn()
        };

        const nativeSearchIndexer = {
            deleteCodeFile: jest.fn(),
            flush: jest.fn()
        };

        const { indexer } = createIndexer({
            dependencyGraph,
            indexDatabase,
            documentIndexer,
            nativeSearchIndexer
        });
        currentIndexer = indexer;

        await (indexer as any).handleDirectoryDeletion(dirPath);

        expect(documentIndexer.deleteFile).toHaveBeenCalledWith("src/doc.md");
        expect(nativeSearchIndexer.deleteCodeFile).toHaveBeenCalledWith("default", "src/a.ts");
        expect(indexDatabase.deleteFile).toHaveBeenCalledWith("src/a.ts");
        expect(dependencyGraph.removeDirectory).toHaveBeenCalledWith(dirPath);
        expect(nativeSearchIndexer.flush).toHaveBeenCalled();
    });

    it("treats hidden roots as ignored paths", () => {
        const { indexer } = createIndexer();
        currentIndexer = indexer;
        const ignored = path.join(tempDir, ".kairo", "cache.json");
        const allowed = path.join(tempDir, "src", "main.ts");

        expect((indexer as any).shouldIgnore(ignored)).toBe(true);
        expect((indexer as any).shouldIgnore(allowed)).toBe(false);
        expect((indexer as any).shouldIgnore("/etc/passwd")).toBe(true);
    });
});
