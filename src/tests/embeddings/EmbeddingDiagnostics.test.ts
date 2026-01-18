import { describe, it, expect, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { computeEmbeddingDiagnostics } from "../../embeddings/EmbeddingDiagnostics.js";

describe("EmbeddingDiagnostics", () => {
    let tempDir: string | null = null;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            tempDir = null;
        }
    });

    it("reports embeddings-ready when required assets exist", () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-embed-diag-"));
        const modelRoot = path.join(tempDir, "demo-model");
        fs.mkdirSync(path.join(modelRoot, "onnx"), { recursive: true });
        fs.writeFileSync(path.join(modelRoot, "config.json"), "{}", "utf-8");
        fs.writeFileSync(path.join(modelRoot, "tokenizer.json"), "{}", "utf-8");
        fs.writeFileSync(path.join(modelRoot, "tokenizer_config.json"), "{}", "utf-8");
        fs.writeFileSync(path.join(modelRoot, "onnx", "model_quantized.onnx"), "x", "utf-8");

        const diagnostics = computeEmbeddingDiagnostics({
            config: {
                provider: "local",
                normalize: true,
                local: { model: "demo-model", dims: 384, quantized: true },
                modelDir: tempDir
            }
        });

        expect(diagnostics.offlineBaselineLevel).toBe("B-embeddings-ready");
        expect(diagnostics.missingAssets).toBeUndefined();
        expect(diagnostics.resolvedModelRoot).toBe(modelRoot);
    });

    it("reports remote downloads when provider is remote", () => {
        const diagnostics = computeEmbeddingDiagnostics({
            config: {
                provider: "remote",
                normalize: true,
                local: { model: "demo-model", dims: 384, quantized: true }
            }
        });

        expect(diagnostics.remoteDownloadsAllowed).toBe(true);
        expect(diagnostics.offlineBaselineLevel).toBe("none");
    });

    it("reports missing assets when local model is absent", () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-embed-diag-missing-"));
        const diagnostics = computeEmbeddingDiagnostics({
            config: {
                provider: "local",
                normalize: true,
                local: { model: "demo-model", dims: 384, quantized: true },
                modelDir: tempDir
            }
        });

        expect(diagnostics.offlineBaselineLevel).toBe("A-core");
        expect(Array.isArray(diagnostics.missingAssets)).toBe(true);
        expect(diagnostics.missingAssets).toContain(path.join("onnx", "model_quantized.onnx"));
    });
});
