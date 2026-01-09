import { describe, it, expect } from "@jest/globals";
import { DocumentProfiler } from "../../documents/DocumentProfiler.js";
import type { DocumentProfile } from "../../types.js";

describe("DocumentProfiler", () => {
    it("parses frontmatter values and prefers the frontmatter title", async () => {
        const content = [
            "---",
            "title: My Doc",
            "draft: true",
            "count: 2",
            "---",
            "# Intro",
            "Body"
        ].join("\n");

        const profiler = new DocumentProfiler(process.cwd());
        const profile = await profiler.profile({
            filePath: "docs/readme.md",
            content,
            kind: "markdown"
        });

        expect(profile.frontmatter).toMatchObject({ title: "My Doc", draft: true, count: 2 });
        expect(profile.title).toBe("My Doc");
    });

    it("extracts mentions and tags outside code fences", async () => {
        const content = [
            "# Intro",
            "Use `inlineCode()` and import { Foo } from 'lib/foo';",
            "Render <Widget /> and ping @dev.",
            "#tag-one #123",
            "```",
            "ignored @inside #tag",
            "```"
        ].join("\n");

        const profiler = new DocumentProfiler(process.cwd());
        const profile = await profiler.profile({
            filePath: "docs/notes.md",
            content,
            kind: "markdown"
        });

        const mentionTexts = profile.mentions?.map(m => m.text) ?? [];
        expect(mentionTexts).toEqual(expect.arrayContaining(["lib/foo", "Widget", "dev"]));
        expect(profile.tags).toEqual(expect.arrayContaining(["tag-one"]));
        expect(profile.tags).not.toEqual(expect.arrayContaining(["123"]));
    });

    it("builds skeletons with indentation and fallback titles", () => {
        const profiler = new DocumentProfiler(process.cwd());
        const outline = [
            {
                id: "intro",
                filePath: "docs/guide.md",
                kind: "markdown",
                title: "Intro",
                level: 1,
                path: ["Intro"],
                range: { startLine: 1, endLine: 2, startByte: 0, endByte: 10 },
                summary: "(1 lines of content)"
            },
            {
                id: "setup",
                filePath: "docs/guide.md",
                kind: "markdown",
                title: "Setup",
                level: 2,
                path: ["Intro", "Setup"],
                range: { startLine: 3, endLine: 4, startByte: 11, endByte: 20 }
            }
        ];

        const profile = {
            filePath: "docs/guide.md",
            kind: "markdown",
            outline,
            stats: { lineCount: 4, charCount: 20, headingCount: 2 }
        } as DocumentProfile;

        const skeleton = profiler.buildSkeleton(profile);
        expect(skeleton).toContain("- Intro (1 lines of content)");
        expect(skeleton).toContain("  - Setup");

        const emptyProfile = {
            filePath: "docs/empty.md",
            kind: "markdown",
            outline: [],
            stats: { lineCount: 0, charCount: 0, headingCount: 0 }
        } as DocumentProfile;
        expect(profiler.buildSkeleton(emptyProfile)).toBe("# empty.md\n");
        expect(DocumentProfiler.normalizeHeading("## My_Title")).toBe("mytitle");
    });
});
