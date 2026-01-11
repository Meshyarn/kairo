import fs from "fs";
import os from "os";
import path from "path";
import { FieldAccessIndex } from "../../ast/FieldAccessIndex.js";
import { ImpactAnalyzer } from "../../engine/ImpactAnalyzer.js";

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "impact-field-"));

describe("ImpactAnalyzer field-level impact", () => {
    it("returns property access locations for a field", async () => {
        const root = makeTempDir();
        const filePath = path.join(root, "consumer.ts");
        fs.writeFileSync(
            filePath,
            `
import type { ChunkResult } from "@kairo/core-rs";
const result: ChunkResult = { text: "hello", tokens: [1] };
console.log(result.text);
`,
            "utf-8"
        );

        const index = new FieldAccessIndex(root);
        await index.indexFile(filePath, { packageName: "@kairo/core-rs", exportNames: ["ChunkResult"] });

        const analyzer = new ImpactAnalyzer({} as any, {} as any, {} as any, undefined, index);
        const result = await analyzer.analyzeFieldImpact("@kairo/core-rs", "ChunkResult", "text");
        expect(result.usages.length).toBe(1);
        expect(result.usages[0].filePath).toBe(filePath);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
