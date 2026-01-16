import * as path from "path";
import { describe, it, expect } from "@jest/globals";
import { DocumentHandlers } from "../../handlers/DocumentHandlers.js";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { PathNormalizer } from "../../utils/PathNormalizer.js";
import type { DocumentProfile } from "../../types.js";
import type { HandlerContext } from "../../handlers/HandlerContext.js";
import { createDefaultToolSpecRegistry } from "../../server/tools/ToolSpecRegistry.js";

const buildOutline = (filePath: string, kind: DocumentProfile["kind"]): DocumentProfile["outline"] => [
    {
        id: "intro",
        filePath,
        kind,
        title: "Intro",
        level: 1,
        path: ["Intro"],
        range: { startLine: 1, endLine: 2, startByte: 0, endByte: 20 }
    },
    {
        id: "setup",
        filePath,
        kind,
        title: "Setup",
        level: 2,
        path: ["Intro", "Setup"],
        range: { startLine: 3, endLine: 4, startByte: 21, endByte: 40 }
    },
    {
        id: "usage",
        filePath,
        kind,
        title: "Usage",
        level: 2,
        path: ["Intro", "Usage"],
        range: { startLine: 5, endLine: 6, startByte: 41, endByte: 60 }
    }
];

const buildContext = (rootPath: string, fileSystem: MemoryFileSystem): HandlerContext => {
    const documentProfiler = {
        profile: async ({ filePath, content, kind }: { filePath: string; content: string; kind: DocumentProfile["kind"] }) => {
            const outline = buildOutline(filePath, kind);
            return {
                filePath,
                kind,
                title: "Test Doc",
                outline,
                links: [],
                parser: { name: "regex", degraded: false },
                stats: {
                    lineCount: content.split(/\r?\n/).length,
                    charCount: content.length,
                    headingCount: outline.length
                }
            } as DocumentProfile;
        },
        buildSkeleton: () => "stub skeleton"
    };

    return {
        rootPath,
        fileSystem: fileSystem as any,
        documentProfiler: documentProfiler as any,
        pathNormalizer: new PathNormalizer(rootPath),
        toolSpecRegistry: createDefaultToolSpecRegistry()
    } as HandlerContext;
};

describe("DocumentHandlers", () => {
    const rootPath = path.resolve(process.cwd(), "doc-handler-tests");
    const content = [
        "# Intro",
        "Intro line",
        "## Setup",
        "Setup line",
        "## Usage",
        "Usage line"
    ].join("\n");

    it("returns a MissingParameter error for required args", async () => {
        const fileSystem = new MemoryFileSystem(rootPath);
        const handler = new DocumentHandlers(buildContext(rootPath, fileSystem));

        const response = await handler.handle("document_toc", {});
        const payload = JSON.parse(response.content[0].text);
        expect(payload.errorCode).toBe("MissingParameter");
    });

    it("returns table of contents and skeleton payloads", async () => {
        const fileSystem = new MemoryFileSystem(rootPath);
        await fileSystem.writeFile("docs/readme.md", content);
        const handler = new DocumentHandlers(buildContext(rootPath, fileSystem));

        const tocResponse = await handler.handle("document_toc", { filePath: "docs/readme.md" });
        const tocPayload = JSON.parse(tocResponse.content[0].text);
        expect(tocPayload.outline.map((section: any) => section.title)).toEqual(["Intro", "Setup", "Usage"]);

        const skeletonResponse = await handler.handle("document_skeleton", { filePath: "docs/readme.md" });
        const skeletonPayload = JSON.parse(skeletonResponse.content[0].text);
        expect(skeletonPayload.skeleton).toBe("stub skeleton");
    });

    it("uses closest heading matches for sections and summarizes content", async () => {
        const fileSystem = new MemoryFileSystem(rootPath);
        await fileSystem.writeFile("docs/readme.md", content);
        const handler = new DocumentHandlers(buildContext(rootPath, fileSystem));

        const response = await handler.handle("document_section", {
            filePath: "docs/readme.md",
            headingPath: "Intro > Missing",
            mode: "summary"
        });
        const payload = JSON.parse(response.content[0].text);

        expect(payload.success).toBe(true);
        expect(payload.degraded).toBe(true);
        expect(payload.reason).toBe("closest_match");
        expect(payload.section.title).toBe("Intro");
        expect(payload.mode).toBe("summary");
    });
});
