import { describe, it, expect, jest } from "@jest/globals";
import { DocumentProfiler, applyMdxPlaceholders } from "../../documents/DocumentProfiler.js";

describe("DocumentProfiler additional coverage", () => {
    it("profiles HTML headings and links", async () => {
        const content = "<h1>Intro</h1><p>Body</p><a href=\"doc.html\">Doc</a>";
        const profiler = new DocumentProfiler(process.cwd());

        const profile = await profiler.profile({
            filePath: "docs/page.html",
            content,
            kind: "html"
        });

        expect(profile.outline[0]?.title).toBe("Intro");
        const htmlLinks = profile.links ?? [];
        expect(htmlLinks.some(link => link.href === "doc.html")).toBe(true);
        expect(profile.parser?.name).toBeDefined();
    });

    it("profiles text outlines using heuristics", async () => {
        const content = [
            "TITLE",
            "=====",
            "",
            "1. First section",
            "",
            "ALL CAPS SECTION",
            "",
            "Body text"
        ].join("\n");

        const profiler = new DocumentProfiler(process.cwd());
        const profile = await profiler.profile({
            filePath: "docs/notes.txt",
            content,
            kind: "text"
        });

        const titles = profile.outline.map(section => section.title);
        expect(titles).toEqual(expect.arrayContaining(["TITLE", "First section", "ALL CAPS SECTION"]));
        expect(profile.parser?.name).toBe("regex");
    });

    it("extracts markdown reference links alongside inline links", async () => {
        const content = [
            "# Title",
            "See [Ref][id] and [Inline](./inline.md).",
            "",
            "[id]: ./ref.md \"Reference\""
        ].join("\n");

        const profiler = new DocumentProfiler(process.cwd());
        const profile = await profiler.profile({
            filePath: "docs/readme.md",
            content,
            kind: "markdown"
        });

        const hrefs = (profile.links ?? []).map(link => link.href);
        expect(hrefs).toEqual(expect.arrayContaining(["./ref.md", "./inline.md"]));
    });

    it("uses ast manager topology when available", async () => {
        const mockAst = {
            extractUniversalTopology: jest.fn(async () => ({
                topLevelSymbols: [{ name: "TopoHeading", level: 2, lineNumber: 3 }],
                imports: [{ name: "TopoLink", source: "./topo.md", lineNumber: 4 }]
            }))
        } as any;

        const profiler = new DocumentProfiler(process.cwd(), undefined, mockAst);
        const content = "# Title\n\n## TopoHeading\n[link](./topo.md)";

        const profile = await profiler.profile({
            filePath: "docs/ast.md",
            content,
            kind: "markdown"
        });

        expect(profile.parser?.name).toBe("tree-sitter");
        expect(profile.outline.some(section => section.title === "TopoHeading")).toBe(true);
        const topoLinks = profile.links ?? [];
        expect(topoLinks.some(link => link.href === "./topo.md")).toBe(true);
    });

    it("applies MDX placeholders for expressions and components", () => {
        const input = "{user} {user.name} <Card title=\"Hello\" count=\"3\" /> <Section>Body</Section> <Icon name=\"star\" />";
        const output = applyMdxPlaceholders(input);

        expect(output).toContain("[[mdx:user]]");
        expect(output).toContain("[[mdx:expr]]");
        expect(output).toContain("Body");
        expect(output).toContain("[[mdx:Icon name=\"star\"]]");
        expect(output).toContain("title=\"Hello\"");
        expect(output).toContain("count=\"3\"");
    });
});
