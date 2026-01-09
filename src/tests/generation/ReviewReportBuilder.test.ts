import { describe, it, expect } from "@jest/globals";
import { ReviewReportBuilder } from "../../generation/review-report-builder.js";
import { scoreVibeAlignment } from "../../generation/vibe-alignment-scorer.js";
import type { StylePack } from "../../types/flow-artifacts.js";

describe("ReviewReportBuilder", () => {
    it("builds a review report for valid content", async () => {
        const builder = new ReviewReportBuilder({});
        const report = await builder.review({
            filePath: "src/foo.ts",
            content: "export const foo = 1;\n",
            oldContent: ""
        });

        expect(report.verdict).toBe("pass");
        expect(report.syntax?.summary).toContain("Syntax");
    });

    it("scores vibe alignment when a StylePack is provided", async () => {
        const builder = new ReviewReportBuilder({}, { strictness: "balanced" });
        const report = await builder.review({
            filePath: "src/foo.ts",
            content: "export const foo = 'bar';\n",
            oldContent: "",
            stylePack: {
                id: "style_test",
                scope: "**/*",
                createdAt: Date.now(),
                profile: {
                    codeStyle: {
                        indent: "spaces",
                        indentSize: 2,
                        quotes: "single",
                        semicolons: true,
                        lineEndings: "lf"
                    },
                    patterns: {
                        imports: [],
                        naming: [{ type: "function", convention: "camelCase", confidence: 0.8 }],
                        fileOrg: { fileNamePattern: "*.ts", directoryPattern: "." }
                    },
                    confidence: "medium"
                }
            }
        });

        expect(report.vibeAlignment?.summary).toContain("Vibe alignment");
        expect(report.vibeAlignment?.score).toBeGreaterThanOrEqual(0.5);
    });

    it("flags formatting, imports, naming, and patterns deviations", () => {
        const stylePack: StylePack = {
            id: "style_test",
            scope: "**/*",
            createdAt: Date.now(),
            profile: {
                codeStyle: {
                    indent: "spaces",
                    indentSize: 2,
                    quotes: "single",
                    semicolons: true,
                    lineEndings: "crlf"
                },
                patterns: {
                    imports: [{ module: "react", style: "named", count: 2 }],
                    naming: [{ type: "variable", convention: "camelCase", confidence: 0.9 }],
                    fileOrg: { fileNamePattern: "*.service.ts", directoryPattern: "." }
                },
                confidence: "medium"
            }
        };
        const content = [
            "import React from \"react\"",
            "\tconst Bad_Name = 1",
            "export function BAD() {",
            "  return \"ok\"",
            "}"
        ].join("\n");
        const result = scoreVibeAlignment({
            filePath: "src/bad.ts",
            content,
            stylePack,
            strictness: "balanced"
        });

        expect(result.breakdown.formatting.score).toBeLessThan(0.5);
        expect(result.breakdown.imports.score).toBeLessThan(0.7);
        expect(result.breakdown.naming.score).toBeLessThan(0.7);
        expect(result.breakdown.patterns.score).toBeLessThan(1);
    });

    it("adjusts verdict based on strictness", () => {
        const stylePack: StylePack = {
            id: "style_test",
            scope: "**/*",
            createdAt: Date.now(),
            profile: {
                codeStyle: {
                    indent: "spaces",
                    indentSize: 2,
                    quotes: "single",
                    semicolons: true,
                    lineEndings: "crlf"
                },
                patterns: {
                    imports: [{ module: "react", style: "named", count: 3 }],
                    naming: [{ type: "variable", convention: "camelCase", confidence: 0.9 }],
                    fileOrg: { fileNamePattern: "*.service.ts", directoryPattern: "." }
                },
                confidence: "medium"
            }
        };
        const content = [
            "import React from \"react\"",
            "\tconst Bad_Name = 1",
            "export function BAD() {",
            "  return \"ok\"",
            "}"
        ].join("\n");
        const permissive = scoreVibeAlignment({
            filePath: "src/bad.ts",
            content,
            stylePack,
            strictness: "permissive"
        });
        const strict = scoreVibeAlignment({
            filePath: "src/bad.ts",
            content,
            stylePack,
            strictness: "strict"
        });

        expect(permissive.verdict).toBe("warn");
        expect(strict.verdict).toBe("block");
    });
});
