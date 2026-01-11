import fs from "fs";
import path from "path";
import { NativeModuleLoader } from "../NativeModuleLoader.js";
import type { CapabilityProvider } from "../EngineManager.js";
import type { ITokenChunkingProvider } from "../Chunking.js";
import { resolveEmbeddingConfigFromEnv } from "../../../embeddings/EmbeddingConfig.js";

export class RustChunkingProvider implements CapabilityProvider<ITokenChunkingProvider> {
    meta = { id: "RustChunkingProvider", tier: "native" as const, priority: 100 };
    private chunker: ITokenChunkingProvider | null = null;
    private tokenizerPath: string | null = null;

    constructor() {
        this.tokenizerPath = resolveTokenizerPath();
        if (!this.tokenizerPath) {
            return;
        }
        const core = NativeModuleLoader.getShared().getRustCore();
        if (!core) return;
        const instance = new core.SmartChunker(this.tokenizerPath);
        this.chunker = {
            chunk: (text: string, maxTokens: number, overlapTokens: number) =>
                instance.chunk(text, maxTokens, overlapTokens)
        };
    }

    isAvailable(): boolean {
        return this.chunker !== null;
    }

    get(): ITokenChunkingProvider {
        return this.chunker as ITokenChunkingProvider;
    }
}

function resolveTokenizerPath(): string | null {
    // 1. Explicit environment variable (Highest priority)
    const explicit = process.env.KAIRO_TOKENIZER_PATH?.trim();
    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }

    const embeddingConfig = resolveEmbeddingConfigFromEnv();
    const modelId = embeddingConfig.local?.model;
    if (!modelId) return null;

    // 2. Resolve Home directory for global cache support
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";

    // 3. Define all standard discovery locations
    const candidates = [
        // a. User-defined model directory
        embeddingConfig.modelDir ? path.join(embeddingConfig.modelDir, modelId) : null,

        // b. Transformers.js local node_modules cache (Project-local)
        path.join(process.cwd(), "node_modules", "@xenova", "transformers", ".cache", modelId),

        // c. Transformers.js global cache (User-level)
        path.join(homeDir, ".cache", "huggingface", "hub", modelId.replace(/\//g, "--")), // Huggingface hub convention

        // d. Kairo bundled models directory
        path.join(process.cwd(), "models", modelId),

        // e. Absolute path fallback for installed package
        path.join(new URL('.', import.meta.url).pathname, "..", "..", "..", "..", "models", modelId)
    ].filter((c): c is string => c !== null);

    for (const dir of candidates) {
        const fullPath = path.join(dir, "tokenizer.json");
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }

    return null;
}