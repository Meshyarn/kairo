import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { resolveEmbeddingConfigFromEnv } from "../../embeddings/EmbeddingConfig.js";

export type TokenChunkResult = {
    text: string;
    start_byte: number;
    end_byte: number;
    start_token: number;
    end_token: number;
};

type SmartChunkerCtor = new (modelPath: string) => {
    chunk: (text: string, maxTokens: number, overlapTokens: number) => TokenChunkResult[];
};

type RustChunkerModule = {
    SmartChunker: SmartChunkerCtor;
};

const require = createRequire(import.meta.url);

export class TokenChunker {
    private static instance: TokenChunker | null = null;
    private static warned = false;
    private rustChunker: InstanceType<SmartChunkerCtor> | null = null;
    private enabled = false;

    private constructor() {
        this.enabled = process.env.KAIRO_RUST_CHUNKING === "true";
        if (!this.enabled) return;
        const tokenizerPath = resolveTokenizerPath();
        if (!tokenizerPath) {
            this.warnOnce("Tokenizer path not found; falling back to character chunking.");
            return;
        }
        try {
            const module = require("@kairo/core-rs") as RustChunkerModule;
            this.rustChunker = new module.SmartChunker(tokenizerPath);
        } catch (error: any) {
            this.warnOnce(`Rust chunker unavailable (${error?.message ?? "unknown error"}); falling back to character chunking.`);
            this.rustChunker = null;
        }
    }

    static getShared(): TokenChunker {
        if (!this.instance) {
            this.instance = new TokenChunker();
        }
        return this.instance;
    }

    isAvailable(): boolean {
        return this.enabled && this.rustChunker !== null;
    }

    chunk(text: string, maxTokens: number, overlapTokens: number): TokenChunkResult[] {
        if (!this.rustChunker) return [];
        return this.rustChunker.chunk(text, maxTokens, overlapTokens);
    }

    private warnOnce(message: string): void {
        if (TokenChunker.warned) return;
        TokenChunker.warned = true;
        console.warn(`[TokenChunker] ${message}`);
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
