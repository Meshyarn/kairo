import { describe, it, expect, jest } from "@jest/globals";
import { HeadingChunker } from "../../documents/chunking/HeadingChunker.js";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_CHUNKING_TOKENS } from "../../orchestration/capabilities/CapabilityIds.js";
import type { CapabilityProvider } from "../../orchestration/capabilities/EngineManager.js";
import type { ITokenChunkingProvider } from "../../orchestration/capabilities/Chunking.js";
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

    it("maps token chunk byte offsets to line ranges", () => {
        EngineManager.resetForTesting();
        const lines = [
            "# Title",
            "",
            "First line here.",
            "Second line here.",
            "Third line here."
        ];
        const tokenContent = lines.join("\n");
        const lineCount = lines.length;
        const outlineAll: DocumentSection[] = [
            {
                id: "section-1",
                filePath: "docs/token.md",
                kind: "markdown",
                title: "Title",
                level: 1,
                path: ["Title"],
                range: { startLine: 1, endLine: lineCount, startByte: 0, endByte: tokenContent.length }
            }
        ];
        const line3 = "First line here.";
        const line4 = "Second line here.";
        const line3Start = tokenContent.indexOf(line3);
        const line4Start = tokenContent.indexOf(line4);
        const line3End = line3Start + line3.length;
        const line4End = line4Start + line4.length;
        const mockProvider: CapabilityProvider<ITokenChunkingProvider> = {
            meta: { id: "TestChunker", tier: "native", priority: 999 },
            isAvailable: () => true,
            get: () => ({
                chunk: () => [
                    { text: line3, startByte: line3Start, endByte: line3End, startToken: 0, endToken: 5 },
                    { text: line4, startByte: line4Start, endByte: line4End, startToken: 5, endToken: 10 }
                ]
            })
        };
        EngineManager.registerProvider(CAP_CHUNKING_TOKENS, mockProvider);
        const chunker = new HeadingChunker();
        const chunks = chunker.chunk("docs/token.md", "markdown", outlineAll, tokenContent, {
            chunkStrategy: "structural",
            chunkProfile: "fast"
        });
        EngineManager.resetForTesting();

        expect(chunks).toHaveLength(2);
        expect(chunks[0].range.startLine).toBe(3);
        expect(chunks[0].range.endLine).toBe(3);
        expect(chunks[0].range.startByte).toBe(line3Start);
        expect(chunks[0].range.endByte).toBe(line3End);
        expect(chunks[1].range.startLine).toBe(4);
        expect(chunks[1].range.endLine).toBe(4);
        expect(chunks[1].range.startByte).toBe(line4Start);
        expect(chunks[1].range.endByte).toBe(line4End);
    });

    it("passes profile-based token limits to the chunker", () => {
        EngineManager.resetForTesting();
        const tokenContent = [
            "# Title",
            "",
            "First line here.",
            "Second line here."
        ].join("\n");
        const outlineAll: DocumentSection[] = [
            {
                id: "section-1",
                filePath: "docs/token.md",
                kind: "markdown",
                title: "Title",
                level: 1,
                path: ["Title"],
                range: { startLine: 1, endLine: 4, startByte: 0, endByte: tokenContent.length }
            }
        ];
        const chunkMock = jest.fn(() => [
            { text: tokenContent, startByte: 0, endByte: tokenContent.length, startToken: 0, endToken: 1 }
        ]);
        const mockProvider: CapabilityProvider<ITokenChunkingProvider> = {
            meta: { id: "TestChunker", tier: "native", priority: 999 },
            isAvailable: () => true,
            get: () => ({ chunk: chunkMock })
        };
        EngineManager.registerProvider(CAP_CHUNKING_TOKENS, mockProvider);
        const chunker = new HeadingChunker();
        chunker.chunk("docs/token.md", "markdown", outlineAll, tokenContent, {
            chunkStrategy: "structural",
            chunkProfile: "deep"
        });

        expect(chunkMock).toHaveBeenCalled();
        const args = chunkMock.mock.calls[0] as unknown as [string, number, number];
        expect(args[1]).toBe(2048);
        expect(args[2]).toBe(128);
        EngineManager.resetForTesting();
    });

    it("falls back to character chunking when token options are absent", () => {
        EngineManager.resetForTesting();
        const tokenContent = [
            "# Title",
            "",
            "First line here.",
            "Second line here.",
            "Third line here."
        ].join("\n");
        const outlineAll: DocumentSection[] = [
            {
                id: "section-1",
                filePath: "docs/token.md",
                kind: "markdown",
                title: "Title",
                level: 1,
                path: ["Title"],
                range: { startLine: 1, endLine: 5, startByte: 0, endByte: tokenContent.length }
            }
        ];
        const chunker = new HeadingChunker();
        const chunks = chunker.chunk("docs/token.md", "markdown", outlineAll, tokenContent, {
            chunkStrategy: "structural",
            maxBlockChars: 40
        });
        EngineManager.resetForTesting();
        expect(chunks.length).toBeGreaterThan(1);
    });
});
