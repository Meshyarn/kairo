import { createRequire } from "module";

type RustVectorModule = {
    cosineScores: (query: Float32Array, vectors: Float32Array[]) => number[];
};

const require = createRequire(import.meta.url);

export class RustVectorMath {
    private static instance: RustVectorMath | null = null;
    private static warned = false;
    private module: RustVectorModule | null = null;

    private constructor() {
        try {
            this.module = require("@kairo/core-rs") as RustVectorModule;
        } catch (error: any) {
            this.warnOnce(`Rust vector math unavailable (${error?.message ?? "unknown error"}); falling back to JS.`);
            this.module = null;
        }
    }

    static getShared(): RustVectorMath {
        if (!this.instance) {
            this.instance = new RustVectorMath();
        }
        return this.instance;
    }

    isAvailable(): boolean {
        return this.module !== null;
    }

    cosineScores(query: Float32Array, vectors: Float32Array[]): number[] {
        if (!this.module) return [];
        return this.module.cosineScores(query, vectors);
    }

    private warnOnce(message: string): void {
        if (RustVectorMath.warned) return;
        RustVectorMath.warned = true;
        console.warn(`[RustVectorMath] ${message}`);
    }
}
