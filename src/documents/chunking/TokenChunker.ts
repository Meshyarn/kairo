import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_CHUNKING_TOKENS } from "../../orchestration/capabilities/CapabilityIds.js";
import type { ITokenChunkingProvider } from "../../orchestration/capabilities/Chunking.js";

export type TokenChunkResult = {
    text: string;
    startByte: number;
    endByte: number;
    startToken: number;
    endToken: number;
};

/** @deprecated Use EngineManager.getProvider(CAP_CHUNKING_TOKENS) instead. */
export class TokenChunker {
    private static instance: TokenChunker | null = null;
    private provider: ITokenChunkingProvider | null = null;

    private constructor() {
        this.provider = EngineManager.getProvider<ITokenChunkingProvider>(CAP_CHUNKING_TOKENS);
    }

    static getShared(): TokenChunker {
        if (!this.instance) {
            this.instance = new TokenChunker();
        }
        return this.instance;
    }

    isAvailable(): boolean {
        return this.resolveProvider() !== null;
    }

    chunk(text: string, maxTokens: number, overlapTokens: number): TokenChunkResult[] {
        const provider = this.resolveProvider();
        if (!provider) return [];
        return provider.chunk(text, maxTokens, overlapTokens);
    }

    private resolveProvider(): ITokenChunkingProvider | null {
        if (!this.provider) {
            this.provider = EngineManager.getProvider<ITokenChunkingProvider>(CAP_CHUNKING_TOKENS);
        }
        return this.provider;
    }
}
