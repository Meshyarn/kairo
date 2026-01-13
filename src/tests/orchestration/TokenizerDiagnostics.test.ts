import { describe, it, expect, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { computeTokenizerDiagnostics } from "../../orchestration/capabilities/TokenizerDiagnostics.js";

describe("TokenizerDiagnostics", () => {
    afterEach(() => {
        delete process.env.KAIRO_TOKENIZER_PATH;
    });

    it("uses explicit tokenizer path when provided", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-tokenizer-"));
        const tokenizerPath = path.join(tempDir, "tokenizer.json");
        fs.writeFileSync(tokenizerPath, "{}", "utf-8");
        process.env.KAIRO_TOKENIZER_PATH = tokenizerPath;

        const diagnostics = computeTokenizerDiagnostics();
        expect(diagnostics.resolvedPath).toBe(tokenizerPath);
        expect(diagnostics.searchedPaths).toContain(tokenizerPath);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("reports missing reason when explicit path is invalid", () => {
        process.env.KAIRO_TOKENIZER_PATH = "/tmp/missing-tokenizer.json";
        const diagnostics = computeTokenizerDiagnostics();
        expect(diagnostics.resolvedPath).toBeUndefined();
        expect(diagnostics.missingReason).toBeDefined();
    });
});
