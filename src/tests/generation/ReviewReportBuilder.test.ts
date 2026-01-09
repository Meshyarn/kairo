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
});
