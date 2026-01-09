import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { MemoryFileSystem, NodeFileSystem } from "../../platform/FileSystem.js";
import { DocumentIndexer } from "../../indexing/DocumentIndexer.js";
import { IndexDatabase } from "../../indexing/IndexDatabase.js";
import { DocumentChunkRepository } from "../../indexing/DocumentChunkRepository.js";

describe("DocumentIndexer sampling", () => {
    let tempDir: string;
    let previousMax: string | undefined;
    let previousHead: string | undefined;
    let previousTail: string | undefined;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-sampling-"));
        previousMax = process.env.KAIRO_DOC_MAX_FILE_BYTES;
        previousHead = process.env.KAIRO_DOC_SAMPLE_HEAD_BYTES;
        previousTail = process.env.KAIRO_DOC_SAMPLE_TAIL_BYTES;
        process.env.KAIRO_DOC_MAX_FILE_BYTES = "10";
        process.env.KAIRO_DOC_SAMPLE_HEAD_BYTES = "4";
        process.env.KAIRO_DOC_SAMPLE_TAIL_BYTES = "3";
    });

    afterEach(() => {
        if (previousMax === undefined) delete process.env.KAIRO_DOC_MAX_FILE_BYTES;
        else process.env.KAIRO_DOC_MAX_FILE_BYTES = previousMax;
        if (previousHead === undefined) delete process.env.KAIRO_DOC_SAMPLE_HEAD_BYTES;
        else process.env.KAIRO_DOC_SAMPLE_HEAD_BYTES = previousHead;
        if (previousTail === undefined) delete process.env.KAIRO_DOC_SAMPLE_TAIL_BYTES;
        else process.env.KAIRO_DOC_SAMPLE_TAIL_BYTES = previousTail;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("samples large files via fallback read when fs sampling fails", async () => {
        const fileSystem = new MemoryFileSystem(tempDir);
        const indexDb = new IndexDatabase(tempDir);
        const indexer = new DocumentIndexer(tempDir, fileSystem, indexDb);

        await fileSystem.writeFile("docs/big.txt", "abcdefghijklmnopqrstuvwxyz");
        await indexer.indexFile("docs/big.txt");

        const repo = new DocumentChunkRepository(indexDb);
        const chunks = repo.listChunksForFile("docs/big.txt");
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[0].text).toContain("[[sampling_applied]]");
        indexDb.close();
    });

    it("samples large files via filesystem handles", async () => {
        fs.mkdirSync(path.join(tempDir, "docs"), { recursive: true });
        const fullPath = path.join(tempDir, "docs", "huge.txt");
        fs.writeFileSync(fullPath, "0123456789abcdef");
        const size = fs.statSync(fullPath).size;

        const fileSystem = new NodeFileSystem(tempDir);
        const indexDb = new IndexDatabase(tempDir);
        const indexer = new DocumentIndexer(tempDir, fileSystem, indexDb);

        const sampled = await (indexer as any).readDocumentContent("docs/huge.txt", size);
        expect(sampled).toContain("[[sampling_applied bytes=");
        indexDb.close();
    });
});
