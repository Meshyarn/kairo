import { NativeModuleLoader } from "../NativeModuleLoader.js";
import type { CapabilityProvider } from "../EngineManager.js";
import type { ITokenChunkingProvider } from "../Chunking.js";
import { computeTokenizerDiagnostics } from "../TokenizerDiagnostics.js";

export class RustChunkingProvider implements CapabilityProvider<ITokenChunkingProvider> {
    meta = { id: "RustChunkingProvider", tier: "native" as const, priority: 100 };
    private chunker: ITokenChunkingProvider | null = null;
    private tokenizerPath: string | null = null;
    private tokenizerDiagnostics = computeTokenizerDiagnostics();

    constructor() {
        this.tokenizerPath = this.tokenizerDiagnostics.resolvedPath ?? null;
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

    diagnose() {
        if (this.chunker) {
            return { available: true };
        }
        if (!this.tokenizerDiagnostics.resolvedPath) {
            return {
                available: false,
                reason: this.tokenizerDiagnostics.missingReason ?? "tokenizer_missing",
                details: {
                    searchedPaths: this.tokenizerDiagnostics.searchedPaths,
                    requiredForNativeChunking: this.tokenizerDiagnostics.requiredForNativeChunking
                }
            };
        }
        const loadError = NativeModuleLoader.getShared().getLoadError();
        if (loadError) {
            return {
                available: false,
                reason: `rust_core_unavailable: ${loadError.message}`
            };
        }
        return { available: false, reason: "rust_chunker_unavailable" };
    }
}
