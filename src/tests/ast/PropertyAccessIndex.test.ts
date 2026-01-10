import fs from "fs";
import os from "os";
import path from "path";
import { PropertyAccessIndex } from "../../ast/PropertyAccessIndex.js";

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "prop-index-"));

describe("PropertyAccessIndex", () => {
    it("indexes property access for typed variables", () => {
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

        const index = new PropertyAccessIndex(root);
        index.indexFile(filePath, { packageName: "@kairo/core-rs", exportNames: ["ChunkResult"] });
        const usages = index.getUsages("@kairo/core-rs", "ChunkResult", "text");
        expect(usages.length).toBe(1);
        expect(usages[0].filePath).toBe(filePath);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
