import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { NavigateHandlers } from "../handlers/NavigateHandlers.js";
import { ReverseImportIndex } from "../ast/ReverseImportIndex.js";
import { ContextEngine } from "../engine/Context.js";
import { JsAstBackend } from "../ast/JsAstBackend.js";
import { PathNormalizer } from "../utils/PathNormalizer.js";

describe("Top 4 Low Coverage Files - Branch Coverage", () => {

    describe("NavigateHandlers", () => {
        let handlers: NavigateHandlers;
        let context: any;

        beforeEach(() => {
            context = {
                orchestrationEngine: { executePillar: jest.fn().mockImplementation(() => Promise.resolve({ ok: true } as any)) },
                pathNormalizer: new PathNormalizer("/root")
            };
            handlers = new NavigateHandlers(context);
        });

        it("covers navigate branches", async () => {
            await handlers.handle("navigate", { target: "MyClass", limit: 5, context: "scope" });
            expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
                "navigate",
                expect.objectContaining({ target: "MyClass", limit: 5, context: "scope" })
            );

            const res = await handlers.handle("navigate", {});
            expect(res.isError).toBe(true);
        });
    });

    describe("ReverseImportIndex", () => {
        let index: ReverseImportIndex;

        beforeEach(() => {
            index = new ReverseImportIndex();
        });

        it("covers buildIndex and importer check branches", () => {
            const projectFiles = new Map([
                ["a.ts", [{ resolvedPath: "b.ts" } as any, { resolvedPath: undefined } as any]],
                ["c.ts", [{ resolvedPath: "b.ts" } as any]]
            ]);
            index.buildIndex(projectFiles);
            
            expect(index.hasImporters("b.ts")).toBe(true);
            expect(index.hasImporters("unknown.ts")).toBe(false);
            expect(index.getImporterCount("b.ts")).toBe(2);
            expect(index.getImporterCount("unknown.ts")).toBe(0);
        });
    });

    describe("ContextEngine", () => {
        let engine: ContextEngine;
        let fs: any;

        beforeEach(() => {
            fs = {
                exists: jest.fn().mockImplementation(() => Promise.resolve(true as any)),
                readFile: jest.fn().mockImplementation(() => Promise.resolve("line1\nline2\nline3" as any)),
                readDir: jest.fn().mockImplementation(() => Promise.resolve(["file1.ts"] as any)),
                stat: jest.fn().mockImplementation(() => Promise.resolve({ isDirectory: () => false } as any))
            };
            engine = new ContextEngine({ ignores: () => false }, fs);
        });

        it("covers mergeIntervals branches", async () => {
            const engineAny = engine as any;
            expect(engineAny.mergeIntervals([])).toEqual([]);
            
            // Overlapping
            const overlapping = [{ start: 1, end: 5 }, { start: 4, end: 10 }];
            expect(engineAny.mergeIntervals(overlapping)).toEqual([{ start: 1, end: 10 }]);

            // Non-overlapping
            const nonOverlapping = [{ start: 1, end: 2 }, { start: 5, end: 6 }];
            expect(engineAny.mergeIntervals(nonOverlapping)).toEqual([{ start: 1, end: 2 }, { start: 5, end: 6 }]);
        });

        it("covers readFragment initial branches", async () => {
            // Case: ranges length 0
            const res = await engine.readFragment("a.ts", []);
            expect(res.ranges[0].end).toBe(3);

            // Case: file not found
            fs.exists.mockResolvedValue(false);
            await expect(engine.readFragment("ghost.ts", [])).rejects.toThrow("File not found");
        });

        it("covers generateTree branches", async () => {
            const engineAny = engine as any;
            // Case: depth < 0
            expect(await engineAny.generateTree("/r", "/r", "", -1)).toBe("");

            // Case: error reading dir
            fs.readDir.mockRejectedValue(new Error("fail"));
            const resErr = await engineAny.generateTree("/r", "/r", "", 1);
            expect(resErr).toContain("[Error reading directory]");
        });
    });

    describe("JsAstBackend", () => {
        let backend: JsAstBackend;

        beforeEach(() => {
            backend = new JsAstBackend();
        });

        it("covers extension and hint branches", async () => {
            // Case: no extension in path (fallback to .ts)
            const doc1 = await backend.parseFile("nofile", "content");
            expect(doc1.languageId).toBe("ts");

            // Case: with languageHint
            const doc2 = await backend.parseFile("a.js", "content", "javascript");
            expect(doc2.languageId).toBe("javascript");

            // Case: getParser extension resolution
            const parser = await backend.getParser("ts");
            const source = parser.parse("const a = 1;", "test.js"); // should work via internal regex
            expect(source).toBeDefined();
        });
    });

});
