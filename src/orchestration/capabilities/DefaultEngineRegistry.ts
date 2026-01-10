import { CAP_CHUNKING_TOKENS, CAP_DIFF_UNIFIED, CAP_SYNTAX_VALIDATE, CAP_VECTOR_COSINE_BATCH, CAP_TEXT_STATS } from "./CapabilityIds.js";
import { EngineManager } from "./EngineManager.js";
import { JsChunkingProvider } from "./providers/JsChunkingProvider.js";
import { JsDiffingProvider } from "./providers/JsDiffingProvider.js";
import { JsTextStatsProvider } from "./providers/JsTextStatsProvider.js";
import { JsVectorMathProvider } from "./providers/JsVectorMathProvider.js";
import { RustChunkingProvider } from "./providers/RustChunkingProvider.js";
import { RustDiffingProvider } from "./providers/RustDiffingProvider.js";
import { RustSyntaxProvider } from "./providers/RustSyntaxProvider.js";
import { RustVectorMathProvider } from "./providers/RustVectorMathProvider.js";
import { TreeSitterSyntaxProvider } from "./providers/TreeSitterSyntaxProvider.js";
import { WasmChunkingProvider } from "./providers/WasmChunkingProvider.js";
import { FeatureFlags } from "../../config/FeatureFlags.js";

export class DefaultEngineRegistry {
    private static initialized = false;

    static init(): void {
        if (this.initialized) return;
        this.initialized = true;

        const rustCoreEnabled = FeatureFlags.isEnabled(FeatureFlags.RUST_CORE_ENABLED, FeatureFlags.getContext());
        const rustChunkingEnabled = resolveRustFeature(
            FeatureFlags.RUST_CHUNKING_ENABLED,
            rustCoreEnabled,
            process.env.KAIRO_RUST_CHUNKING
        );
        const wasmChunkingEnabled = FeatureFlags.isEnabled(FeatureFlags.WASM_CHUNKING_ENABLED, FeatureFlags.getContext());
        const rustDiffEnabled = resolveRustFeature(FeatureFlags.RUST_DIFF_ENABLED, rustCoreEnabled);
        const rustSyntaxEnabled = resolveRustFeature(FeatureFlags.RUST_SYNTAX_ENABLED, rustCoreEnabled);
        const rustVectorEnabled = resolveRustFeature(FeatureFlags.RUST_VECTOR_ENABLED, rustCoreEnabled);

        if (rustChunkingEnabled) {
            EngineManager.registerProvider(CAP_CHUNKING_TOKENS, new RustChunkingProvider());
        }
        if (wasmChunkingEnabled) {
            EngineManager.registerProvider(CAP_CHUNKING_TOKENS, new WasmChunkingProvider());
        }
        EngineManager.registerProvider(CAP_CHUNKING_TOKENS, new JsChunkingProvider());

        if (rustDiffEnabled) {
            EngineManager.registerProvider(CAP_DIFF_UNIFIED, new RustDiffingProvider());
        }
        EngineManager.registerProvider(CAP_DIFF_UNIFIED, new JsDiffingProvider());

        if (rustSyntaxEnabled) {
            EngineManager.registerProvider(CAP_SYNTAX_VALIDATE, new RustSyntaxProvider());
        }
        EngineManager.registerProvider(CAP_SYNTAX_VALIDATE, new TreeSitterSyntaxProvider());

        if (rustVectorEnabled) {
            EngineManager.registerProvider(CAP_VECTOR_COSINE_BATCH, new RustVectorMathProvider());
        }
        EngineManager.registerProvider(CAP_VECTOR_COSINE_BATCH, new JsVectorMathProvider());
        EngineManager.registerProvider(CAP_TEXT_STATS, new JsTextStatsProvider());
    }

    static resetForTesting(): void {
        this.initialized = false;
    }
}

function resolveRustFeature(flag: string, coreEnabled: boolean, legacyEnv?: string): boolean {
    if (!coreEnabled) return false;
    if (FeatureFlags.isExplicit(flag)) {
        return FeatureFlags.isEnabled(flag, FeatureFlags.getContext());
    }
    if (legacyEnv !== undefined) {
        return parseBoolish(legacyEnv);
    }
    return true;
}

function parseBoolish(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") return false;
    return false;
}
