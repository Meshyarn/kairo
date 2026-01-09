import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { IndexDatabase } from "../../indexing/IndexDatabase.js";
import { DocumentIndexer } from "../../indexing/DocumentIndexer.js";
import { DocumentChunkRepository } from "../../indexing/DocumentChunkRepository.js";

describe("DocumentIndexer", () => {
    let tempDir: string;
    let fileSystem: MemoryFileSystem;
    let indexDb: IndexDatabase;
    let repo: DocumentChunkRepository;
    let indexer: DocumentIndexer;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-indexer-"));
        fileSystem = new MemoryFileSystem(tempDir);
        indexDb = new IndexDatabase(tempDir);
        repo = new DocumentChunkRepository(indexDb);
        indexer = new DocumentIndexer(tempDir, fileSystem, indexDb);
    });

    afterEach(() => {
        indexDb.close();
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("detects supported document types and ignore rules", () => {
        expect(indexer.isSupported("docs/readme.md")).toBe(true);
        expect(indexer.isSupported("README")).toBe(true);
        expect(indexer.isSupported("image.png")).toBe(false);

        indexer.updateIgnorePatterns(["docs/secret.md"]);
        expect(indexer.shouldIgnore("docs/secret.md")).toBe(true);
    });

    it("indexes log files and deletes stored chunks", async () => {
        await fileSystem.writeFile("logs/app.log", "line one\n\nline two\n");

        await indexer.indexFile("logs/app.log");
        const chunks = repo.listChunksForFile("logs/app.log");
        expect(chunks.length).toBe(2);

        indexer.deleteFile("logs/app.log");
        expect(repo.listChunksForFile("logs/app.log")).toHaveLength(0);
    });

    it("indexes markdown files into heading chunks", async () => {
        await fileSystem.writeFile("docs/readme.md", "# Title\n\nBody text\n");

        await indexer.indexFile("docs/readme.md");
        const chunks = repo.listChunksForFile("docs/readme.md");
        expect(chunks.length).toBeGreaterThan(0);
    });
});
