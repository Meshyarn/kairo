import { describe, it, expect } from "@jest/globals";
import { HotSpotDetector } from "../../../engine/ClusterSearch/HotSpotDetector.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { SymbolIndex } from "../../../ast/SymbolIndex.js";
import type { DefinitionSymbol, SymbolInfo } from "../../../types.js";

const makeSymbol = (
    name: string,
    type: DefinitionSymbol["type"] = "function",
    modifiers?: string[]
): DefinitionSymbol => ({
    name,
    type,
    modifiers,
    range: { startLine: 0, endLine: 0, startByte: 0, endByte: 1 }
});

describe("HotSpotDetector", () => {
    it("ranks hot spots by score and explains entry exports", async () => {
        const symbols = new Map<string, SymbolInfo[]>([
            ["src/index.ts", [makeSymbol("UserService", "class", ["export"])]],
            ["src/other.ts", [makeSymbol("Helper", "function")]]
        ]);

        const symbolIndex = {
            getAllSymbols: async () => symbols
        } as unknown as SymbolIndex;

        const dependencyGraph = {
            getDependencies: async (filePath: string) => {
                if (filePath === "src/index.ts") return ["a", "b", "c", "d"];
                return new Array(10).fill("x");
            }
        } as unknown as DependencyGraph;

        const detector = new HotSpotDetector(symbolIndex, dependencyGraph, {
            minIncomingRefs: 2,
            trackEntryExports: true,
            patternMatchers: [/Service$/],
            maxHotSpots: 1
        });

        const results = await detector.detectHotSpots();

        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe("src/index.ts");
        expect(results[0].reasons).toEqual(expect.arrayContaining(["entry_export", "pattern_match"]));
        expect(results[0].score).toBeGreaterThan(0);
    });

    it("handles dependency lookup errors and skips import/export symbols", async () => {
        const symbols = new Map<string, SymbolInfo[]>([
            ["src/util.ts", [makeSymbol("useHelper", "function")]],
            ["src/skip.ts", [{ ...makeSymbol("Ignored", "function"), type: "export" } as SymbolInfo]]
        ]);

        const symbolIndex = {
            getAllSymbols: async () => symbols
        } as unknown as SymbolIndex;

        const dependencyGraph = {
            getDependencies: async () => {
                throw new Error("stale");
            }
        } as unknown as DependencyGraph;

        const detector = new HotSpotDetector(symbolIndex, dependencyGraph, {
            minIncomingRefs: 5,
            trackEntryExports: false,
            patternMatchers: [/^use/i],
            maxHotSpots: 5
        });

        const results = await detector.detectHotSpots();

        expect(results).toHaveLength(1);
        expect(results[0].symbol.name).toBe("useHelper");
        expect(results[0].reasons).toEqual(["pattern_match"]);
    });
});
