import type { CapabilityProvider } from "../EngineManager.js";
import type { ITextStatsProvider, TextStats } from "../TextStats.js";

export class JsTextStatsProvider implements CapabilityProvider<ITextStatsProvider> {
    meta = { id: "JsTextStatsProvider", tier: "js" as const, priority: 10 };

    isAvailable(): boolean {
        return true;
    }

    get(): ITextStatsProvider {
        return {
            compute: (text: string): TextStats => computeStats(text)
        };
    }
}

function computeStats(text: string): TextStats {
    if (!text) {
        return { characters: 0, words: 0, lines: 0 };
    }
    const characters = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text.split(/\r?\n/).length;
    return { characters, words, lines };
}
