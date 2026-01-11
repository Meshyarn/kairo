import { NativeModuleLoader } from "../NativeModuleLoader.js";
import type { CapabilityProvider } from "../EngineManager.js";
import type { IVectorMathProvider } from "../VectorMath.js";

export class RustVectorMathProvider implements CapabilityProvider<IVectorMathProvider> {
    meta = { id: "RustVectorMathProvider", tier: "native" as const, priority: 100 };
    private provider: IVectorMathProvider | null = null;

    constructor() {
        const core = NativeModuleLoader.getShared().getRustCore();
        if (!core) return;
        this.provider = {
            cosineScores: (query: Float32Array, vectors: Float32Array[]) => core.cosineScores(query, vectors)
        };
    }

    isAvailable(): boolean {
        return this.provider !== null;
    }

    get(): IVectorMathProvider {
        return this.provider as IVectorMathProvider;
    }
}
