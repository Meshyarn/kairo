import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

describe("PdfExtractor", () => {
    let tempDir: string;
    const envKeys = [
        "KAIRO_PDF_MAX_PAGES",
        "KAIRO_PDF_MAX_CHARS",
        "KAIRO_PDF_MIN_CHARS",
        "KAIRO_PDF_MIN_CHARS_PER_PAGE"
    ];
    const envSnapshot: Record<string, string | undefined> = {};

    beforeEach(() => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-extract-"));
        for (const key of envKeys) {
            envSnapshot[key] = process.env[key];
        }
    });

    afterEach(() => {
        for (const key of envKeys) {
            if (envSnapshot[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = envSnapshot[key];
            }
        }
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("throws a PdfExtractError when the file cannot be read", async () => {
        const { extractPdfAsText } = await import("../../documents/extractors/PdfExtractor.js");
        await expect(extractPdfAsText(path.join(tempDir, "missing.pdf"))).rejects.toMatchObject({
            reason: "pdf_read_failed"
        });
    });

    it("throws a PdfExtractError when the parser module is unavailable", async () => {
        const filePath = path.join(tempDir, "sample.pdf");
        fs.writeFileSync(filePath, "fake");

        const { extractPdfAsText } = await import("../../documents/extractors/PdfExtractor.js");
        await expect(extractPdfAsText(filePath)).rejects.toMatchObject({
            reason: "pdf_parser_missing"
        });
    });
});
