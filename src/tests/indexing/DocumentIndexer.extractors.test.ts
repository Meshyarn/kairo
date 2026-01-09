import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

class DocxExtractError extends Error {
    public reason: string;
    constructor(reason: string) {
        super(reason);
        this.reason = reason;
    }
}

class XlsxExtractError extends Error {
    public reason: string;
    constructor(reason: string) {
        super(reason);
        this.reason = reason;
    }
}

class PdfExtractError extends Error {
    public reason: string;
    constructor(reason: string) {
        super(reason);
        this.reason = reason;
    }
}

const extractDocxAsHtml = jest.fn(async () => {
    throw new DocxExtractError("docx_failed");
});
const extractXlsxAsText = jest.fn(async () => {
    throw new XlsxExtractError("xlsx_failed");
});
const extractPdfAsText = jest.fn(async () => {
    throw new PdfExtractError("pdf_failed");
});

jest.unstable_mockModule("../../documents/extractors/DocxExtractor.js", () => ({
    extractDocxAsHtml,
    DocxExtractError
}));
jest.unstable_mockModule("../../documents/extractors/XlsxExtractor.js", () => ({
    extractXlsxAsText,
    XlsxExtractError
}));
jest.unstable_mockModule("../../documents/extractors/PdfExtractor.js", () => ({
    extractPdfAsText,
    PdfExtractError
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
        extractDocxAsHtml.mockClear();
        extractXlsxAsText.mockClear();
        extractPdfAsText.mockClear();
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

        expect(extractDocxAsHtml).toHaveBeenCalled();
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

        expect(extractXlsxAsText).toHaveBeenCalled();
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

        expect(extractPdfAsText).toHaveBeenCalled();
        const repo = new DocumentChunkRepository(indexDb);
        expect(repo.listChunksForFile("docs/sample.pdf")).toHaveLength(0);
        indexDb.close();
    });
});
