import { EngineManager } from "../orchestration/capabilities/EngineManager.js";
import { CAP_VECTOR_COSINE_BATCH } from "../orchestration/capabilities/CapabilityIds.js";
import type { IVectorMathProvider } from "../orchestration/capabilities/VectorMath.js";

/** @deprecated Use EngineManager.getProvider(CAP_VECTOR_COSINE_BATCH) instead. */
export class RustVectorMath {
    private static instance: RustVectorMath | null = null;
    private provider: IVectorMathProvider | null = null;

    private constructor() {
        this.provider = EngineManager.getProvider<IVectorMathProvider>(CAP_VECTOR_COSINE_BATCH);
    }

    static getShared(): RustVectorMath {
        if (!this.instance) {
            this.instance = new RustVectorMath();
        }
        return this.instance;
    }

    isAvailable(): boolean {
        return this.resolveProvider() !== null;
    }

    cosineScores(query: Float32Array, vectors: Float32Array[]): number[] {
        const provider = this.resolveProvider();
        if (!provider) return [];
        return provider.cosineScores(query, vectors);
    }

    private resolveProvider(): IVectorMathProvider | null {
        if (!this.provider) {
            this.provider = EngineManager.getProvider<IVectorMathProvider>(CAP_VECTOR_COSINE_BATCH);
        }
        return this.provider;
    }
}
