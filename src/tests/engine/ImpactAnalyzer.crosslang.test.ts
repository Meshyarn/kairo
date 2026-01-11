import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { ImpactAnalyzer } from "../../engine/ImpactAnalyzer.js";
import { PropertyAccessIndex } from "../../ast/PropertyAccessIndex.js";

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

    it("includes field-level usage locations when available", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "impact-crosslang-"));
        const consumerPath = path.join(root, "consumer.ts");
        fs.writeFileSync(
            consumerPath,
            `
import type { ChunkResult } from "@kairo/core-rs";
const result: ChunkResult = { text: "hello", tokens: [1] };
console.log(result.text);
`,
            "utf-8"
        );

        const dependencyGraph = {
            getImporters: async () => [
                { from: "src/consumer.ts", to: "crates/core-rs/index.d.ts", type: "named" }
            ]
        };
        const propertyIndex = new PropertyAccessIndex(root);
        propertyIndex.indexFile(consumerPath, { packageName: "@kairo/core-rs", exportNames: ["ChunkResult"] });

        const analyzer = new ImpactAnalyzer(
            dependencyGraph as any,
            {} as any,
            {} as any,
            undefined,
            propertyIndex
        );

        const diff = {
            added: [],
            removed: [],
            changed: [{
                exportName: "ChunkResult",
                kind: "field" as const,
                before: { kind: "interface", fields: [{ name: "text", type: "string" }] },
                after: { kind: "interface", fields: [{ name: "text", type: "number" }] },
                breaking: true
            }],
            degraded: false,
            reasons: []
        };

        const result = await analyzer.analyzeCrossLangImpact("@kairo/core-rs", "crates/core-rs/index.d.ts", diff);
        expect(result.fieldImpacts?.length).toBe(1);
        expect(result.fieldImpacts?.[0].fieldName).toBe("text");
        expect(result.fieldImpacts?.[0].usages[0].filePath).toBe(consumerPath);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
