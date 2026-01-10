import type { CapabilityProvider } from "../EngineManager.js";
import type { IDiffingProvider, DiffResult } from "../Diffing.js";
import { PatienceDiff } from "../../../engine/PatienceDiff.js";

export class JsDiffingProvider implements CapabilityProvider<IDiffingProvider> {
    meta = { id: "JsDiffingProvider", tier: "js" as const, priority: 10 };

    isAvailable(): boolean {
        return true;
    }

    get(): IDiffingProvider {
        return {
            diffUnified: (oldText: string, newText: string, contextLines: number): DiffResult => {
                const hunks = PatienceDiff.diff(oldText, newText, { contextLines, semantic: true });
                const summary = PatienceDiff.summarize(hunks);
                const diff = PatienceDiff.formatUnified(hunks);
                return { diff, added: summary.added, removed: summary.removed };
            }
        };
    }
}
