import * as path from "path";
import { DocumentKind, DocumentOutlineOptions, DocumentSection } from "../../types.js";
import { StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";
import { applyMdxPlaceholders } from "../DocumentProfiler.js";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_CHUNKING_TOKENS } from "../../orchestration/capabilities/CapabilityIds.js";
import type { ITokenChunkingProvider } from "../../orchestration/capabilities/Chunking.js";
import {
    computeEndByte,
    computeLineOffsets,
    findLineForByte,
    hash,
    normalizeSegments,
    resolveChunkProfile,
    resolveTokenOptions,
    splitFixedSegments,
    splitStructuralSegments
} from "./HeadingChunkerUtils.js";

export class HeadingChunker {
    public chunk(
        filePath: string,
        kind: DocumentKind,
        outline: DocumentSection[],
        content: string,
        options: DocumentOutlineOptions = {}
    ): StoredDocumentChunk[] {
        const normalizedContent = kind === "mdx" ? applyMdxPlaceholders(content) : content;
        const lines = normalizedContent.split(/\r?\n/);
        const lineOffsets = computeLineOffsets(normalizedContent);
        const strategy = options.chunkStrategy ?? "structural";
        const chunks: StoredDocumentChunk[] = [];
        const chunkProfile = resolveChunkProfile(options);
        const tokenOptions = resolveTokenOptions(options, chunkProfile);
        const tokenChunker = EngineManager.getProvider<ITokenChunkingProvider>(
            CAP_CHUNKING_TOKENS,
            tokenOptions?.preferredTier ? { preferredTier: tokenOptions.preferredTier } : undefined
        );
        const useTokenChunker = tokenChunker !== null && tokenOptions !== null;
        const effectiveOutline = outline.length === 0
            ? [{
                filePath,
                kind,
                title: path.basename(filePath),
                level: 1,
                path: [path.basename(filePath)],
                range: { startLine: 1, endLine: lines.length, startByte: 0, endByte: normalizedContent.length }
            }]
            : outline;

        for (let index = 0; index < effectiveOutline.length; index += 1) {
            const section = effectiveOutline[index];
            const range = {
                startLine: section.range.startLine,
                endLine: section.range.endLine
            };

            if (strategy === "heading") {
                chunks.push(this.buildChunk({
                    filePath,
                    kind,
                    sectionPath: section.path,
                    heading: section.title,
                    headingLevel: section.level,
                    startLine: range.startLine,
                    endLine: range.endLine,
                    lines,
                    lineOffsets,
                    ordinal: 0
                }));
                continue;
            }

            const segments = strategy === "fixed"
                ? splitFixedSegments(lines, range.startLine, range.endLine, options)
                : normalizeSegments(
                    splitStructuralSegments(lines, range.startLine, range.endLine, options),
                    options
                );

            let ordinal = 0;
            for (const segment of segments) {
                if (!segment.text.trim()) continue;
                if (useTokenChunker && tokenOptions) {
                    const segmentStartByte = lineOffsets[segment.startLine - 1] ?? 0;
                    const tokenChunks = tokenChunker.chunk(
                        segment.text,
                        tokenOptions.params.maxTokens,
                        tokenOptions.params.overlapTokens
                    );
                    if (tokenChunks.length === 0) {
                        chunks.push(this.buildChunk({
                            filePath,
                            kind,
                            sectionPath: section.path,
                            heading: section.title,
                            headingLevel: section.level,
                            startLine: segment.startLine,
                            endLine: segment.endLine,
                            lines,
                            lineOffsets,
                            ordinal
                        }));
                        ordinal += 1;
                        continue;
                    }
                    for (const tokenChunk of tokenChunks) {
                        const startByte = segmentStartByte + tokenChunk.startByte;
                        const endByte = segmentStartByte + tokenChunk.endByte;
                        const startLine = findLineForByte(startByte, lineOffsets);
                        const endLine = findLineForByte(Math.max(endByte - 1, startByte), lineOffsets);
                        chunks.push(this.buildChunkFromText({
                            filePath,
                            kind,
                            sectionPath: section.path,
                            heading: section.title,
                            headingLevel: section.level,
                            startLine,
                            endLine,
                            startByte,
                            endByte,
                            text: tokenChunk.text,
                            ordinal
                        }));
                        ordinal += 1;
                    }
                } else {
                    chunks.push(this.buildChunk({
                        filePath,
                        kind,
                        sectionPath: section.path,
                        heading: section.title,
                        headingLevel: section.level,
                        startLine: segment.startLine,
                        endLine: segment.endLine,
                        lines,
                        lineOffsets,
                        ordinal
                    }));
                    ordinal += 1;
                }
            }
        }

        return chunks;
    }

    private buildChunk(args: {
        filePath: string;
        kind: DocumentKind;
        sectionPath: string[];
        heading: string | null;
        headingLevel: number | null;
        startLine: number;
        endLine: number;
        lines: string[];
        lineOffsets: number[];
        ordinal: number;
    }): StoredDocumentChunk {
        const text = args.lines.slice(args.startLine - 1, args.endLine).join("\n");
        return {
            id: hash(`${args.filePath}\n${args.sectionPath.join(" > ")}\n${args.startLine}:${args.endLine}\n${args.ordinal}`),
            filePath: args.filePath,
            kind: args.kind,
            sectionPath: args.sectionPath,
            heading: args.heading,
            headingLevel: args.headingLevel,
            range: {
                startLine: args.startLine,
                endLine: args.endLine,
                startByte: args.lineOffsets[args.startLine - 1] ?? 0,
                endByte: computeEndByte(args.endLine, args.lines, args.lineOffsets)
            },
            text,
            contentHash: hash(text),
            updatedAt: Date.now()
        };
    }

    private buildChunkFromText(args: {
        filePath: string;
        kind: DocumentKind;
        sectionPath: string[];
        heading: string | null;
        headingLevel: number | null;
        startLine: number;
        endLine: number;
        startByte: number;
        endByte: number;
        text: string;
        ordinal: number;
    }): StoredDocumentChunk {
        const text = args.text;
        return {
            id: hash(`${args.filePath}\n${args.sectionPath.join(" > ")}\n${args.startLine}:${args.endLine}\n${args.ordinal}`),
            filePath: args.filePath,
            kind: args.kind,
            sectionPath: args.sectionPath,
            heading: args.heading,
            headingLevel: args.headingLevel,
            range: {
                startLine: args.startLine,
                endLine: args.endLine,
                startByte: args.startByte,
                endByte: args.endByte
            },
            text,
            contentHash: hash(text),
            updatedAt: Date.now()
        };
    }
}

