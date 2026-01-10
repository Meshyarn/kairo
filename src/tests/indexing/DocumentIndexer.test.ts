import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { IndexDatabase } from "../../indexing/IndexDatabase.js";
import { DocumentIndexer } from "../../indexing/DocumentIndexer.js";
import { DocumentChunkRepository } from "../../indexing/DocumentChunkRepository.js";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_CHUNKING_TOKENS } from "../../orchestration/capabilities/CapabilityIds.js";
import type { ITokenChunkingProvider } from "../../orchestration/capabilities/Chunking.js";

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
        EngineManager.resetForTesting();
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

    it("uses token chunker when available and maps ranges", async () => {
        const tokenContent = [
            "# Title",
            "",
            "First line here.",
            "Second line here.",
            "Third line here."
        ].join("\n");
        const line3 = "First line here.";
        const line4 = "Second line here.";
        const line3Start = tokenContent.indexOf(line3);
        const line4Start = tokenContent.indexOf(line4);
        const line3End = line3Start + line3.length;
        const line4End = line4Start + line4.length;
        const mockProvider: ITokenChunkingProvider = {
            chunk: () => [
                { text: line3, startByte: line3Start, endByte: line3End, startToken: 0, endToken: 5 },
                { text: line4, startByte: line4Start, endByte: line4End, startToken: 5, endToken: 10 }
            ]
        };
        EngineManager.resetForTesting();
        EngineManager.registerProvider(CAP_CHUNKING_TOKENS, {
            meta: { id: "DocumentIndexerTestChunker", tier: "native", priority: 10000 },
            isAvailable: () => true,
            get: () => mockProvider
        });
        indexer = new DocumentIndexer(tempDir, fileSystem, indexDb, {
            outlineOptions: { chunkStrategy: "structural", chunkProfile: "fast" }
        });

        await fileSystem.writeFile("docs/token.md", tokenContent);
        await indexer.indexFile("docs/token.md");
        const chunks = repo.listChunksForFile("docs/token.md");

        expect(chunks).toHaveLength(2);
        expect(chunks[0].range.startLine).toBe(3);
        expect(chunks[0].range.endLine).toBe(3);
        expect(chunks[0].range.startByte).toBe(line3Start);
        expect(chunks[0].range.endByte).toBe(line3End);
        expect(chunks[1].range.startLine).toBe(4);
        expect(chunks[1].range.endLine).toBe(4);
        expect(chunks[1].range.startByte).toBe(line4Start);
        expect(chunks[1].range.endByte).toBe(line4End);
    });
});
