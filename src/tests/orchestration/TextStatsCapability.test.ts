import { afterEach, describe, expect, it } from "@jest/globals";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_TEXT_STATS } from "../../orchestration/capabilities/CapabilityIds.js";
import type { ITextStatsProvider } from "../../orchestration/capabilities/TextStats.js";

describe("Text stats capability", () => {
    afterEach(() => {
        EngineManager.resetForTesting();
    });

    it("computes basic text metrics via registry", () => {
        const provider = EngineManager.getProvider<ITextStatsProvider>(CAP_TEXT_STATS);
        expect(provider).not.toBeNull();
        const stats = provider!.compute("hello world\nsecond line");
        expect(stats.characters).toBe(23);
        expect(stats.words).toBe(4);
        expect(stats.lines).toBe(2);
    });
});
