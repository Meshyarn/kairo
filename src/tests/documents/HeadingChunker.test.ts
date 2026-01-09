import { describe, it, expect } from "@jest/globals";
import { HeadingChunker } from "../../documents/chunking/HeadingChunker.js";
import { DocumentSection } from "../../types.js";

const content = `# Title
Line one
Line two
Line three
Line four
Line five
Line six
Line seven
Line eight
Line nine
Line ten
`;

const outline: DocumentSection[] = [
    {
        id: "section-1",
        filePath: "docs/sample.md",
        kind: "markdown",
        title: "Title",
        level: 1,
        path: ["Title"],
        range: { startLine: 1, endLine: 11, startByte: 0, endByte: content.length }
    }
];

describe("HeadingChunker", () => {
    it("splits fixed chunks by target size", () => {
        const chunker = new HeadingChunker();
        const chunks = chunker.chunk("docs/sample.md", "markdown", outline, content, {
            chunkStrategy: "fixed",
            targetChunkChars: 40,
            maxBlockChars: 40
        });
        expect(chunks.length).toBeGreaterThan(1);
    });

    it("splits structural chunks by maxBlockChars", () => {
        const chunker = new HeadingChunker();
        const chunks = chunker.chunk("docs/sample.md", "markdown", outline, content, {
            chunkStrategy: "structural",
            maxBlockChars: 50
        });
        expect(chunks.length).toBeGreaterThan(1);
    });

    it("creates heading chunks per section", () => {
        const chunker = new HeadingChunker();
        const multiOutline: DocumentSection[] = [
            {
                id: "intro",
                filePath: "docs/sample.md",
                kind: "markdown",
                title: "Intro",
                level: 1,
                path: ["Intro"],
                range: { startLine: 1, endLine: 4, startByte: 0, endByte: 10 }
            },
            {
                id: "details",
                filePath: "docs/sample.md",
                kind: "markdown",
                title: "Details",
                level: 2,
                path: ["Intro", "Details"],
                range: { startLine: 5, endLine: 9, startByte: 11, endByte: 20 }
            }
        ];
        const chunks = chunker.chunk("docs/sample.md", "markdown", multiOutline, content, {
            chunkStrategy: "heading"
        });
        expect(chunks).toHaveLength(2);
        expect(chunks[0].heading).toBe("Intro");
        expect(chunks[1].heading).toBe("Details");
    });

    it("honors code block flags and affects segmentation for tables/lists", () => {
        const chunker = new HeadingChunker();
        const complex = [
            "# Title",
            "Paragraph text",
            "```js",
            "console.log('skip');",
            "```",
            "| A | B |",
            "| - | - |",
            "- item one",
            "1. item two",
            "tail"
        ].join("\n");
        const complexOutline: DocumentSection[] = [
            {
                id: "section",
                filePath: "docs/complex.md",
                kind: "markdown",
                title: "Title",
                level: 1,
                path: ["Title"],
                range: { startLine: 1, endLine: 10, startByte: 0, endByte: complex.length }
            }
        ];
        const withoutExtras = chunker.chunk("docs/complex.md", "markdown", complexOutline, complex, {
            chunkStrategy: "structural",
            includeCodeBlocks: false,
            includeTables: false,
            includeLists: false,
            maxBlockChars: 200
        });
        const withExtras = chunker.chunk("docs/complex.md", "markdown", complexOutline, complex, {
            chunkStrategy: "structural",
            includeCodeBlocks: true,
            includeTables: true,
            includeLists: true,
            maxBlockChars: 200
        });
        const mergedText = withoutExtras.map(chunk => chunk.text).join("\n");
        expect(mergedText).not.toContain("console.log");
        expect(mergedText).toContain("| A | B |");
        expect(mergedText).toContain("- item one");
        expect(withExtras.length).toBeGreaterThan(withoutExtras.length);
    });

    it("merges small fixed segments when minSectionChars is set", () => {
        const chunker = new HeadingChunker();
        const smallContent = [
            "# Title",
            "Short",
            "Tiny",
            "Small"
        ].join("\n");
        const smallOutline: DocumentSection[] = [
            {
                id: "section",
                filePath: "docs/small.md",
                kind: "markdown",
                title: "Title",
                level: 1,
                path: ["Title"],
                range: { startLine: 1, endLine: 4, startByte: 0, endByte: smallContent.length }
            }
        ];
        const chunks = chunker.chunk("docs/small.md", "markdown", smallOutline, smallContent, {
            chunkStrategy: "fixed",
            targetChunkChars: 10,
            maxBlockChars: 10,
            minSectionChars: 50
        });
        expect(chunks).toHaveLength(1);
    });
});
