import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { FallbackResolver } from "../../resolution/FallbackResolver.js";

describe("FallbackResolver", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fallback-resolver-"));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("returns null when ghost builder is missing", async () => {
        const resolver = new FallbackResolver({ getRecentlyModified: () => [] } as any, {} as any);
        await expect(resolver.reconstructGhostInterface("Ghost")).resolves.toBeNull();
    });

    it("delegates ghost reconstruction to builder when provided", async () => {
        const ghostBuilder = {
            reconstruct: jest.fn(async () => ({ name: "GhostSymbol" }))
        } as any;
        const resolver = new FallbackResolver({ getRecentlyModified: () => [] } as any, {} as any, ghostBuilder);

        const result = await resolver.reconstructGhostInterface("GhostSymbol");
        expect(ghostBuilder.reconstruct).toHaveBeenCalledWith("GhostSymbol");
        expect(result).toEqual({ name: "GhostSymbol" });
    });

    it("parses recent files for symbols and skips failures", async () => {
        const fileA = path.join(tempDir, "alpha.ts");
        const fileB = path.join(tempDir, "beta.ts");
        fs.writeFileSync(fileA, "export class Alpha {}\n");
        fs.writeFileSync(fileB, "export class Beta {}\n");

        const symbolIndex = {
            getRecentlyModified: jest.fn(() => [fileA, fileB])
        } as any;

        const skeletonGenerator = {
            generateStructureJson: jest.fn(async (filePath: string) => {
                if (filePath === fileB) {
                    throw new Error("parse-failed");
                }
                return [{ name: "Alpha" }, { name: "Other" }];
            })
        } as any;

        const resolver = new FallbackResolver(symbolIndex, skeletonGenerator);
        const results = await resolver.parseFileForSymbol("Alpha");

        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe(fileA);
        expect(results[0].symbol.name).toBe("Alpha");
    });

    it("regex search finds symbol patterns in recent files", async () => {
        const file = path.join(tempDir, "gamma.ts");
        fs.writeFileSync(file, "class Gamma {}\nconst Delta = 1;\n");

        const symbolIndex = {
            getRecentlyModified: jest.fn(() => [file])
        } as any;

        const resolver = new FallbackResolver(symbolIndex, {} as any);
        const results = await resolver.regexSymbolSearch("Gamma");

        expect(results.length).toBe(1);
        expect(results[0].filePath).toBe(file);
        expect(results[0].symbol.name).toBe("Gamma");
    });
});
