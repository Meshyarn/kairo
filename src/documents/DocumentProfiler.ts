import * as path from "path";
import { DocumentKind, DocumentOutlineOptions, DocumentProfile } from "../types.js";
import { DocumentLinkResolver } from "./DocumentLinkResolver.js";
import { parseMarkdownWithRemark, type RemarkParseResult } from "./RemarkDocumentParser.js";
import { TreeSitterHtmlParser } from "./html/TreeSitterHtmlParser.js";
import { AstManager } from "../ast/AstManager.js";
import type { HeadingNode, LinkNode } from "./DocumentProfilerTypes.js";
import { applyMaxDepth, resolveHeadings } from "./DocumentProfilerHeadings.js";
import { resolveLinks } from "./DocumentProfilerLinks.js";
import { extractMentions, extractTags } from "./DocumentProfilerMentions.js";
import { buildOutline, resolveTitle } from "./DocumentProfilerOutline.js";
import { resolveParserInfo } from "./DocumentProfilerParserInfo.js";
import { computeLineOffsets, parseFrontmatter, splitLines } from "./DocumentProfilerParsing.js";

export { applyMdxPlaceholders } from "./DocumentProfilerMdx.js";

export interface DocumentProfileInput {
    filePath: string;
    content: string;
    kind: DocumentKind;
    options?: DocumentOutlineOptions;
}

export class DocumentProfiler {
    private static markdownTreeSitterDisabled = false;
    private static markdownTreeSitterDisabledReason?: string;

    constructor(
        private readonly rootPath: string,
        private readonly linkResolver: DocumentLinkResolver = new DocumentLinkResolver(rootPath),
        private readonly astManager: AstManager = AstManager.getInstance()
    ) {}

    private static htmlParser = new TreeSitterHtmlParser();
    private static htmlInitStarted = false;

    public async profile(input: DocumentProfileInput): Promise<DocumentProfile> {
        const options = input.options ?? {};
        const lines = splitLines(input.content);
        const lineOffsets = computeLineOffsets(input.content);

        const shouldUseTreeSitter = input.kind === "markdown" && !DocumentProfiler.markdownTreeSitterDisabled;
        let treeMarkdownHeadings: HeadingNode[] | null = null;
        let treeMarkdownLinks: LinkNode[] | null = null;

        if (shouldUseTreeSitter) {
            try {
                const topology = await this.astManager.extractUniversalTopology(input.filePath, input.content);
                treeMarkdownHeadings = topology.topLevelSymbols.map((s: any) => ({
                    title: s.name,
                    level: s.level ?? 1,
                    line: s.lineNumber
                }));
                treeMarkdownLinks = topology.imports.map((i: any) => ({
                    text: i.name ?? "",
                    href: i.source,
                    line: i.lineNumber
                }));
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                if (!DocumentProfiler.markdownTreeSitterDisabled && message.includes("Incompatible language version")) {
                    DocumentProfiler.markdownTreeSitterDisabled = true;
                    DocumentProfiler.markdownTreeSitterDisabledReason = message;
                    console.warn(`[DocumentProfiler] Disabled markdown tree-sitter extraction: ${message}`);
                } else if (
                    DocumentProfiler.markdownTreeSitterDisabledReason &&
                    message === DocumentProfiler.markdownTreeSitterDisabledReason
                ) {
                    // already logged (avoid spamming on every markdown file)
                } else {
                    console.warn(`[DocumentProfiler] AstManager fallback for ${input.filePath}:`, e);
                }
            }
        }

        const shouldUseHtmlTreeSitter = input.kind === "html" && DocumentProfiler.htmlParser.isAvailable();
        if (shouldUseHtmlTreeSitter && !DocumentProfiler.htmlInitStarted) {
            DocumentProfiler.htmlInitStarted = true;
            void DocumentProfiler.htmlParser.initialize();
        }

        const frontmatter = options.includeFrontmatter === false
            ? undefined
            : parseFrontmatter(input.content);

        const remarkParsed = (input.kind === "markdown" || input.kind === "mdx")
            ? parseMarkdownWithRemark(input.content, input.kind)
            : null;

        const treeHtmlHeadings = shouldUseHtmlTreeSitter
            ? DocumentProfiler.htmlParser.tryParseHeadings(input.content)
            : null;

        const headings = applyMaxDepth(resolveHeadings({
            kind: input.kind,
            lines,
            remarkParsed,
            treeMarkdownHeadings,
            treeHtmlHeadings,
            content: input.content
        }), options.maxDepth);

        const parserInfo = resolveParserInfo({
            kind: input.kind,
            content: input.content,
            treeMarkdownHeadings,
            treeHtmlHeadings,
            remarkParsed
        });
        const outline = buildOutline({
            filePath: input.filePath,
            kind: input.kind,
            headings,
            lines,
            lineOffsets
        });

        const rawLinks = resolveLinks({
            kind: input.kind,
            lines,
            remarkParsed,
            content: input.content,
            treeMarkdownLinks
        });
        const links = rawLinks.map(link => {
            const resolved = this.linkResolver.resolveLink(input.filePath, link.href, link.text);
            const lineIndex = Math.max(0, Math.min(lines.length - 1, (link.line ?? 1) - 1));
            const lineText = lines[lineIndex] ?? "";
            const startByte = lineOffsets[lineIndex] ?? 0;
            const endByte = startByte + lineText.length;
            return {
                ...resolved,
                range: {
                    startLine: lineIndex + 1,
                    endLine: lineIndex + 1,
                    startByte,
                    endByte
                }
            };
        });
        const mentions = extractMentions(lines);
        const tags = extractTags(lines);

        const title = resolveTitle(frontmatter, outline, input.filePath);
        return {
            filePath: input.filePath,
            kind: input.kind,
            title,
            frontmatter,
            parser: parserInfo,
            outline,
            links,
            mentions,
            tags,
            stats: {
                lineCount: lines.length,
                charCount: input.content.length,
                headingCount: headings.length
            }
        };
    }

    public buildSkeleton(profile: DocumentProfile): string {
        const outline = profile.outline;
        if (!outline || outline.length === 0) {
            const fallback = profile.title ?? path.basename(profile.filePath);
            return `# ${fallback}\n`;
        }
        const lines: string[] = [];
        for (const section of outline) {
            const indent = "  ".repeat(Math.max(0, section.level - 1));
            let line = `${indent}- ${section.title}`;
            if (section.summary) {
                line += ` ${section.summary}`;
            }
            lines.push(line);
        }
        return lines.join("\n");
    }

    public static normalizeHeading(value: string): string {
        return value
            .toLowerCase()
            .replace(/\s+/g, " ")
            .replace(/[#:*_`~]+/g, "")
            .trim();
    }
}
