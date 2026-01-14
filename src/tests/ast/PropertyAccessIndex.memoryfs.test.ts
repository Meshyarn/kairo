import { describe, it, expect } from "@jest/globals";
import path from "path";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { PropertyAccessIndex } from "../../ast/PropertyAccessIndex.js";

describe("PropertyAccessIndex (MemoryFileSystem)", () => {
    it("indexes property access without disk IO", async () => {
        const root = path.resolve("tmp", `prop-index-mem-${Date.now()}`);
        const fileSystem = new MemoryFileSystem(root);
        const filePath = path.join(root, "consumer.ts");

        await fileSystem.writeFile(
            filePath,
            `
import type { ChunkResult } from "@kairo/core-rs";
const result: ChunkResult = { text: "hello", tokens: [1] };
console.log(result.text);
`,
        );

        const index = new PropertyAccessIndex(root, fileSystem);
        index.indexFile(filePath, { packageName: "@kairo/core-rs", exportNames: ["ChunkResult"] });
        const usages = index.getUsages("@kairo/core-rs", "ChunkResult", "text");
        expect(usages.length).toBe(1);
        expect(usages[0].filePath).toBe(filePath);
    });
});

