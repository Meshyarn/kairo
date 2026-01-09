import { describe, it, expect } from "@jest/globals";
import { ReviewReportBuilder } from "../../generation/review-report-builder.js";

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
});
