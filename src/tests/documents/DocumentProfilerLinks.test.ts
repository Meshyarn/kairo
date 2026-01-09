import { describe, it, expect, jest } from "@jest/globals";
import { DocumentProfiler } from "../../documents/DocumentProfiler.js";

const content = `# Docs\n\nSee [Install][install] for details.\n\n[install]: guide.md "Guide"\n`;

jest.setTimeout(20000);

describe("DocumentProfiler links", () => {
    it("resolves reference-style links via remark", async () => {
        const profiler = new DocumentProfiler(process.cwd());
        const profile = await profiler.profile({
            filePath: "docs/readme.md",
            content,
            kind: "markdown"
        });

        const link = profile.links?.find(item => item.href === "guide.md");
        expect(link?.resolvedPath).toBe("docs/guide.md");
        expect(link?.range?.startLine).toBe(3);
    });
});
