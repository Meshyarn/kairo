import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_CHUNKING_TOKENS } from "../../orchestration/capabilities/CapabilityIds.js";
import { NativeModuleLoader } from "../../orchestration/capabilities/NativeModuleLoader.js";
import { FeatureFlags } from "../../config/FeatureFlags.js";
import type { ITokenChunkingProvider } from "../../orchestration/capabilities/Chunking.js";

describe("DefaultEngineRegistry", () => {
    let tempDir: string | null = null;

    afterEach(() => {
        EngineManager.resetForTesting();
        FeatureFlags.resetForTesting();
        NativeModuleLoader.resetForTesting();
        delete process.env.KAIRO_TOKENIZER_PATH;
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        tempDir = null;
        jest.restoreAllMocks();
    });

    it("falls back to JS chunking when rust core is disabled", () => {
        FeatureFlags.setExplicit(FeatureFlags.RUST_CORE_ENABLED, false, "off");
        FeatureFlags.setExplicit(FeatureFlags.RUST_CHUNKING_ENABLED, true, "on");

        const provider = EngineManager.getProvider<ITokenChunkingProvider>(CAP_CHUNKING_TOKENS);
        expect(provider).not.toBeNull();

        const diagnostics = EngineManager.getDiagnosticsSnapshot({ detail: "summary" });
        expect(diagnostics.capabilities[CAP_CHUNKING_TOKENS].selected?.id).toBe("JsChunkingProvider");
    });

    it("falls back to JS chunking when rust module fails to load", () => {
        FeatureFlags.setExplicit(FeatureFlags.RUST_CORE_ENABLED, true, "on");
        FeatureFlags.setExplicit(FeatureFlags.RUST_CHUNKING_ENABLED, true, "on");
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-tokenizer-"));
        const tokenizerPath = path.join(tempDir, "tokenizer.json");
        fs.writeFileSync(tokenizerPath, "{}");
        process.env.KAIRO_TOKENIZER_PATH = tokenizerPath;
        NativeModuleLoader.setTestLoader(() => {
            throw new Error("load failed");
        });

        const provider = EngineManager.getProvider<ITokenChunkingProvider>(CAP_CHUNKING_TOKENS);
        expect(provider).not.toBeNull();

        const diagnostics = EngineManager.getDiagnosticsSnapshot({ detail: "summary" });
        expect(diagnostics.capabilities[CAP_CHUNKING_TOKENS].selected?.id).toBe("JsChunkingProvider");
        expect(warnSpy).toHaveBeenCalled();
    });
});
