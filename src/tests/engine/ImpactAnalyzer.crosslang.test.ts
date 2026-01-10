import { describe, it, expect } from "@jest/globals";
import { ImpactAnalyzer } from "../../engine/ImpactAnalyzer.js";

describe("ImpactAnalyzer cross-language impact", () => {
    it("returns consumer files for a package entry", async () => {
        const dependencyGraph = {
            getImporters: async () => [
                { from: "src/consumer.ts", to: "crates/core-rs/index.d.ts", type: "named" }
            ]
        };
        const callGraphBuilder = {};
        const symbolIndex = {};

        const analyzer = new ImpactAnalyzer(
            dependencyGraph as any,
            callGraphBuilder as any,
            symbolIndex as any
        );

        const diff = {
            added: [],
            removed: [],
            changed: [{ exportName: "ChunkResult", kind: "field" as const, before: {}, after: {}, breaking: true }],
            degraded: false,
            reasons: []
        };

        const result = await analyzer.analyzeCrossLangImpact("@kairo/core-rs", "crates/core-rs/index.d.ts", diff);
        expect(result.consumerFiles).toContain("src/consumer.ts");
        expect(result.changedExports).toContain("ChunkResult");
    });

    it("propagates degraded contract signals", async () => {
        const dependencyGraph = {
            getImporters: async () => []
        };
        const analyzer = new ImpactAnalyzer(dependencyGraph as any, {} as any, {} as any);
        const diff = {
            added: [],
            removed: [],
            changed: [],
            degraded: true,
            reasons: ["contract_manifest_missing"]
        };
        const result = await analyzer.analyzeCrossLangImpact("@kairo/core-rs", "crates/core-rs/index.d.ts", diff);
        expect(result.degraded).toBe(true);
        expect(result.reasons).toContain("contract_manifest_missing");
    });
});
