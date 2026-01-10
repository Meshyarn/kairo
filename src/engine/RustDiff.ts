import { EngineManager } from "../orchestration/capabilities/EngineManager.js";
import { CAP_DIFF_UNIFIED } from "../orchestration/capabilities/CapabilityIds.js";
import type { IDiffingProvider } from "../orchestration/capabilities/Diffing.js";

/** @deprecated Use EngineManager.getProvider(CAP_DIFF_UNIFIED) instead. */
export class RustDiff {
    private static instance: RustDiff | null = null;
    private provider: IDiffingProvider | null = null;

    private constructor() {
        this.provider = EngineManager.getProvider<IDiffingProvider>(CAP_DIFF_UNIFIED);
    }

    static getShared(): RustDiff {
        if (!this.instance) {
            this.instance = new RustDiff();
        }
        return this.instance;
    }

    isAvailable(): boolean {
        return this.resolveProvider() !== null;
    }

    diffUnified(oldText: string, newText: string, contextLines: number): { diff: string; added: number; removed: number } {
        const provider = this.resolveProvider();
        if (!provider) {
            return { diff: "", added: 0, removed: 0 };
        }
        return provider.diffUnified(oldText, newText, contextLines);
    }

    private resolveProvider(): IDiffingProvider | null {
        if (!this.provider) {
            this.provider = EngineManager.getProvider<IDiffingProvider>(CAP_DIFF_UNIFIED);
        }
        return this.provider;
    }
}
