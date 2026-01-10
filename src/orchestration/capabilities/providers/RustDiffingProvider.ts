import { NativeModuleLoader } from "../NativeModuleLoader.js";
import type { CapabilityProvider } from "../EngineManager.js";
import type { IDiffingProvider, DiffResult } from "../Diffing.js";

export class RustDiffingProvider implements CapabilityProvider<IDiffingProvider> {
    meta = { id: "RustDiffingProvider", tier: "native" as const, priority: 100 };
    private provider: IDiffingProvider | null = null;

    constructor() {
        const core = NativeModuleLoader.getShared().getRustCore();
        if (!core) return;
        this.provider = {
            diffUnified: (oldText: string, newText: string, contextLines: number): DiffResult =>
                core.diffUnified(oldText, newText, contextLines)
        };
    }

    isAvailable(): boolean {
        return this.provider !== null;
    }

    get(): IDiffingProvider {
        return this.provider as IDiffingProvider;
    }
}
