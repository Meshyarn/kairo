import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

const loadForIndex = jest.fn(async (filePath: string) => {
    const ext = path.extname(filePath);
    return {
        filePath,
        sourceFormat: ext.replace(".", "") || "unknown",
        kind: "text",
        profileContent: "",
        contentForSearch: "",
        degraded: true,
        reasons: [`${ext.replace(".", "")}_extract_failed`],
        warnings: [],
        stats: {}
    };
});

jest.unstable_mockModule("../../documents/DocumentContentLoader.js", () => ({
    DocumentContentLoader: class {
        loadForIndex = loadForIndex;
    }
}));

let DocumentIndexer: typeof import("../../indexing/DocumentIndexer.js").DocumentIndexer;
let NodeFileSystem: typeof import("../../platform/FileSystem.js").NodeFileSystem;
let IndexDatabase: typeof import("../../indexing/IndexDatabase.js").IndexDatabase;
let DocumentChunkRepository: typeof import("../../indexing/DocumentChunkRepository.js").DocumentChunkRepository;

describe("DocumentIndexer extractor failures", () => {
    let tempDir: string;

    beforeAll(async () => {
        ({ DocumentIndexer } = await import("../../indexing/DocumentIndexer.js"));
        ({ NodeFileSystem } = await import("../../platform/FileSystem.js"));
        ({ IndexDatabase } = await import("../../indexing/IndexDatabase.js"));
        ({ DocumentChunkRepository } = await import("../../indexing/DocumentChunkRepository.js"));
    });

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-extractors-"));
        loadForIndex.mockClear();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("skips indexing when DOCX extraction fails", async () => {
        const fileSystem = new NodeFileSystem(tempDir);
        const indexDb = new IndexDatabase(tempDir);
        const indexer = new DocumentIndexer(tempDir, fileSystem, indexDb);

        const filePath = path.join(tempDir, "docs", "report.docx");
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, "not a real docx");

        await indexer.indexFile("docs/report.docx");

        expect(loadForIndex).toHaveBeenCalled();
        const repo = new DocumentChunkRepository(indexDb);
        expect(repo.listChunksForFile("docs/report.docx")).toHaveLength(0);
        indexDb.close();
    });

    it("skips indexing when XLSX extraction fails", async () => {
        const fileSystem = new NodeFileSystem(tempDir);
        const indexDb = new IndexDatabase(tempDir);
        const indexer = new DocumentIndexer(tempDir, fileSystem, indexDb);

        const filePath = path.join(tempDir, "docs", "sheet.xlsx");
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, "not a real xlsx");

        await indexer.indexFile("docs/sheet.xlsx");

        expect(loadForIndex).toHaveBeenCalled();
        const repo = new DocumentChunkRepository(indexDb);
        expect(repo.listChunksForFile("docs/sheet.xlsx")).toHaveLength(0);
        indexDb.close();
    });

    it("skips indexing when PDF extraction fails", async () => {
        const fileSystem = new NodeFileSystem(tempDir);
        const indexDb = new IndexDatabase(tempDir);
        const indexer = new DocumentIndexer(tempDir, fileSystem, indexDb);

        const filePath = path.join(tempDir, "docs", "sample.pdf");
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, "%PDF-1.4");

        await indexer.indexFile("docs/sample.pdf");

        expect(loadForIndex).toHaveBeenCalled();
        const repo = new DocumentChunkRepository(indexDb);
        expect(repo.listChunksForFile("docs/sample.pdf")).toHaveLength(0);
        indexDb.close();
    });
});
