import { describe, it, expect } from "@jest/globals";
import { AstAwareDiff } from "../../engine/AstAwareDiff.js";
import type { DefinitionSymbol } from "../../types.js";
import type { SkeletonGenerator } from "../../ast/SkeletonGenerator.js";

const makeSymbol = (
    name: string,
    content: string,
    options: { type?: DefinitionSymbol["type"]; startLine?: number } = {}
): DefinitionSymbol => ({
    name,
    type: options.type ?? "function",
    range: {
        startLine: options.startLine ?? 0,
        endLine: (options.startLine ?? 0) + 1,
        startByte: 0,
        endByte: content.length
    }
});

describe("AstAwareDiff", () => {
    it("returns empty summary when symbols cannot be extracted", async () => {
        const generator = {
            generateStructureJson: async () => {
                throw new Error("boom");
            }
        } as unknown as SkeletonGenerator;
        const diff = new AstAwareDiff(generator);

        const summary = await diff.diff("test.ts", "old", "new");

        expect(summary).toBeDefined();
        expect(summary?.changes).toEqual([]);
        expect(summary?.stats).toEqual({ added: 0, removed: 0, modified: 0, renamed: 0, moved: 0 });
    });

    it("detects moves when content is unchanged but location shifts", async () => {
        const oldContent = "function greet() { return 1; }";
        const newContent = oldContent;
        let callCount = 0;
        const generator = {
            generateStructureJson: async () => {
                callCount += 1;
                return callCount === 1
                    ? [makeSymbol("greet", oldContent, { startLine: 0 })]
                    : [makeSymbol("greet", newContent, { startLine: 4 })];
            }
        } as unknown as SkeletonGenerator;
        const diff = new AstAwareDiff(generator);

        const summary = await diff.diff("test.ts", oldContent, newContent);

        expect(summary?.changes).toHaveLength(1);
        expect(summary?.changes[0]).toMatchObject({ type: "move", name: "greet" });
        expect(summary?.stats.moved).toBe(1);
    });

    it("detects modifications when the body changes", async () => {
        const oldContent = "function greet() { return 1; }";
        const newContent = "function greet() { return 2; }";
        const generator = {
            generateStructureJson: async (_filePath: string, content: string) => {
                return content === oldContent ? [makeSymbol("greet", oldContent)] : [makeSymbol("greet", newContent)];
            }
        } as unknown as SkeletonGenerator;
        const diff = new AstAwareDiff(generator);

        const summary = await diff.diff("test.ts", oldContent, newContent);

        expect(summary?.changes).toHaveLength(1);
        expect(summary?.changes[0]).toMatchObject({ type: "modify", name: "greet" });
        expect(summary?.stats.modified).toBe(1);
    });

    it("detects renames using body similarity", async () => {
        const oldContent = "function alpha() { const output = value + total; return output; }";
        const newContent = "function beta() { const output = value + total; return output; }";
        let callCount = 0;
        const generator = {
            generateStructureJson: async () => {
                callCount += 1;
                return callCount === 1 ? [makeSymbol("alpha", oldContent)] : [makeSymbol("beta", newContent)];
            }
        } as unknown as SkeletonGenerator;
        const diff = new AstAwareDiff(generator);

        const summary = await diff.diff("test.ts", oldContent, newContent);

        expect(summary?.changes).toHaveLength(1);
        expect(summary?.changes[0]).toMatchObject({ type: "rename", oldName: "alpha", name: "beta" });
        expect(summary?.stats.renamed).toBe(1);
    });

    it("tracks additions and removals for unrelated symbols", async () => {
        const oldContent = "function alpha() { return 1; }";
        const newContent = "function beta() { return 2; }";
        const generator = {
            generateStructureJson: async (_filePath: string, content: string) => {
                return content === oldContent ? [makeSymbol("alpha", oldContent)] : [makeSymbol("beta", newContent)];
            }
        } as unknown as SkeletonGenerator;
        const diff = new AstAwareDiff(generator);

        const summary = await diff.diff("test.ts", oldContent, newContent);
        const changeTypes = summary?.changes.map(change => change.type).sort();

        expect(changeTypes).toEqual(["add", "remove"]);
        expect(summary?.stats.added).toBe(1);
        expect(summary?.stats.removed).toBe(1);
    });
});
