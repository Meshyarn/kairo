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
    const explicit = process.env.KAIRO_TOKENIZER_PATH?.trim();
    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }
    const embeddingConfig = resolveEmbeddingConfigFromEnv();
    const modelDir = embeddingConfig.modelDir ?? process.env.KAIRO_MODEL_DIR;
    const modelId = embeddingConfig.local?.model;
    if (modelDir && modelId) {
        const candidate = path.join(modelDir, modelId, "tokenizer.json");
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
