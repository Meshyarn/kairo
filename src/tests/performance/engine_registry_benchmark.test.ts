import { describe, expect, it } from "@jest/globals";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_TEXT_STATS } from "../../orchestration/capabilities/CapabilityIds.js";
import type { ITextStatsProvider, TextStats } from "../../orchestration/capabilities/TextStats.js";

const SAMPLE_TEXT = "hello world\nsecond line";
const WARMUP_ITERATIONS = 1000;
const MEASURE_ITERATIONS = 100000;

describe("Performance - engine registry", () => {
    it("keeps registry lookup overhead under threshold", () => {
        EngineManager.resetForTesting();
        EngineManager.registerProvider(CAP_TEXT_STATS, {
            meta: { id: "PerfTextStatsProvider", tier: "js", priority: 1000 },
            isAvailable: () => true,
            get: () => ({ compute: (text: string) => computeStats(text) })
        });

        for (let i = 0; i < WARMUP_ITERATIONS; i += 1) {
            EngineManager.getProvider<ITextStatsProvider>(CAP_TEXT_STATS);
        }

        const start = performance.now();
        for (let i = 0; i < MEASURE_ITERATIONS; i += 1) {
            EngineManager.getProvider<ITextStatsProvider>(CAP_TEXT_STATS);
        }
        const elapsed = performance.now() - start;
        const avgMs = elapsed / MEASURE_ITERATIONS;
        const maxAvgMs = Number(process.env.KAIRO_PERF_REGISTRY_MAX_MS ?? "1");
        console.log(`[PERF] registry_lookup avg ${avgMs.toFixed(6)}ms`);
        expect(avgMs).toBeLessThan(maxAvgMs);
    });

    it("keeps registry path within 5% of direct call", () => {
        EngineManager.resetForTesting();
        EngineManager.registerProvider(CAP_TEXT_STATS, {
            meta: { id: "PerfTextStatsProvider", tier: "js", priority: 1000 },
            isAvailable: () => true,
            get: () => ({ compute: (text: string) => computeStats(text) })
        });

        const directStart = performance.now();
        for (let i = 0; i < MEASURE_ITERATIONS; i += 1) {
            computeStats(SAMPLE_TEXT);
        }
        const directElapsed = performance.now() - directStart;

        const provider = EngineManager.getProvider<ITextStatsProvider>(CAP_TEXT_STATS);
        expect(provider).not.toBeNull();
        const registryStart = performance.now();
        for (let i = 0; i < MEASURE_ITERATIONS; i += 1) {
            provider!.compute(SAMPLE_TEXT);
        }
        const registryElapsed = performance.now() - registryStart;

        const ratio = registryElapsed / directElapsed;
        const maxRatio = Number(process.env.KAIRO_PERF_REGISTRY_RATIO_MAX ?? "1.05");
        console.log(`[PERF] registry_vs_direct ratio ${ratio.toFixed(3)}`);
        expect(ratio).toBeLessThanOrEqual(maxRatio);
    });
});

function computeStats(text: string): TextStats {
    if (!text) {
        return { characters: 0, words: 0, lines: 0 };
    }
    const characters = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text.split(/\r?\n/).length;
    return { characters, words, lines };
}
