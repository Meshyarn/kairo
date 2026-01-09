import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { ClusterPrecomputationEngine } from "../../../engine/ClusterSearch/ClusterPrecomputationEngine.js";
import type { HotSpot } from "../../../engine/ClusterSearch/HotSpotDetector.js";
import type { SymbolInfo } from "../../../types.js";

const makeHotSpot = (name: string, filePath: string): HotSpot => ({
    filePath,
    score: 10,
    reasons: [],
    symbol: {
        name,
        type: "function",
        range: { startLine: 0, endLine: 0, startByte: 0, endByte: 1 }
    } as SymbolInfo
});

describe("ClusterPrecomputationEngine", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("precomputes hot spots in batches and builds scoped queries", async () => {
        jest.useFakeTimers();
        const hotSpots = [
            makeHotSpot("Alpha", "/tmp/My File.ts"),
            makeHotSpot("Beta", "/tmp/Beta.ts"),
            makeHotSpot("Gamma", "/tmp/Gamma.ts"),
            makeHotSpot("Delta", "/tmp/Delta.ts")
        ];
        const detector = {
            detectHotSpots: async () => hotSpots
        };
        const executeSearch = jest.fn(async () => undefined) as jest.MockedFunction<
            (query: string, options: unknown) => Promise<unknown>
        >;

        const engine = new ClusterPrecomputationEngine(detector as any, executeSearch, {
            intervalMs: 1000,
            maxQueriesPerCycle: 3,
            batchSize: 2
        });

        engine.start();
        await jest.runOnlyPendingTimersAsync();

        expect(executeSearch).toHaveBeenCalledTimes(3);
        expect(executeSearch.mock.calls[0][0]).toBe("Alpha in:My");
        expect(executeSearch.mock.calls[0][1]).toMatchObject({ maxClusters: 3, expansionDepth: 2 });

        engine.stop();
        await jest.advanceTimersByTimeAsync(2000);
        expect(executeSearch).toHaveBeenCalledTimes(3);
    });

    it("does not schedule immediate runs when stopped", async () => {
        jest.useFakeTimers();
        const detector = { detectHotSpots: async () => [] as HotSpot[] };
        const executeSearch = jest.fn(async () => undefined) as jest.MockedFunction<
            (query: string, options: unknown) => Promise<unknown>
        >;
        const engine = new ClusterPrecomputationEngine(detector as any, executeSearch, { intervalMs: 1000 });

        engine.requestImmediateRun();
        await jest.runOnlyPendingTimersAsync();

        expect(executeSearch).not.toHaveBeenCalled();
    });
});
