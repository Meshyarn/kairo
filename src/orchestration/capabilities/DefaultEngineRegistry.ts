import { CAP_CHUNKING_TOKENS, CAP_DIFF_UNIFIED, CAP_SYNTAX_VALIDATE, CAP_VECTOR_COSINE_BATCH } from "./CapabilityIds.js";
import { EngineManager } from "./EngineManager.js";
import { JsChunkingProvider } from "./providers/JsChunkingProvider.js";
import { JsDiffingProvider } from "./providers/JsDiffingProvider.js";
import { JsVectorMathProvider } from "./providers/JsVectorMathProvider.js";
import { RustChunkingProvider } from "./providers/RustChunkingProvider.js";
import { RustDiffingProvider } from "./providers/RustDiffingProvider.js";
import { RustSyntaxProvider } from "./providers/RustSyntaxProvider.js";
import { RustVectorMathProvider } from "./providers/RustVectorMathProvider.js";
import { TreeSitterSyntaxProvider } from "./providers/TreeSitterSyntaxProvider.js";

export class DefaultEngineRegistry {
    private static initialized = false;

    static init(): void {
        if (this.initialized) return;
        this.initialized = true;

        EngineManager.registerProvider(CAP_CHUNKING_TOKENS, new RustChunkingProvider());
        EngineManager.registerProvider(CAP_CHUNKING_TOKENS, new JsChunkingProvider());
        EngineManager.registerProvider(CAP_DIFF_UNIFIED, new RustDiffingProvider());
        EngineManager.registerProvider(CAP_DIFF_UNIFIED, new JsDiffingProvider());
        EngineManager.registerProvider(CAP_SYNTAX_VALIDATE, new RustSyntaxProvider());
        EngineManager.registerProvider(CAP_SYNTAX_VALIDATE, new TreeSitterSyntaxProvider());
        EngineManager.registerProvider(CAP_VECTOR_COSINE_BATCH, new RustVectorMathProvider());
        EngineManager.registerProvider(CAP_VECTOR_COSINE_BATCH, new JsVectorMathProvider());
    }
}
