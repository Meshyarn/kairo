import type { SymbolInfo } from "./ast.js";
import type { FileVersionInfo } from "./engine.js";

export type DocumentKind = "markdown" | "mdx" | "html" | "css" | "text" | "code_comment" | "unknown";

export interface DocumentSection {
    id: string;
    filePath: string;
    kind: DocumentKind;
    title: string;
    level: number;
    path: string[];
    range: { startLine: number; endLine: number; startByte: number; endByte: number };
    contentHash?: string;
    summary?: string;
}

export interface DocumentProfile {
    filePath: string;
    kind: DocumentKind;
    title?: string;
    frontmatter?: Record<string, unknown>;
    parser?: {
        name: "tree-sitter" | "remark" | "regex";
        degraded: boolean;
        reason?: string;
    };
    outline: DocumentSection[];
    links?: Array<{
        text?: string;
        href: string;
        resolvedPath?: string;
        hashFragment?: string;
        range?: { startLine: number; endLine: number; startByte: number; endByte: number };
    }>;
    mentions?: Array<{
        text: string;
        kind: "symbol" | "path";
        line: number;
    }>;
    tags?: string[];
    stats: { lineCount: number; charCount: number; headingCount: number };
}

export interface DocumentOutlineOptions {
    maxDepth?: number;
    includeFrontmatter?: boolean;
    includeCodeBlocks?: boolean;
    includeLists?: boolean;
    includeTables?: boolean;
    minSectionChars?: number;
    chunkStrategy?: "heading" | "structural" | "fixed";
    targetChunkChars?: number;
    maxBlockChars?: number;
    chunkProfile?: "fast" | "balanced" | "deep";
    targetChunkTokens?: number;
    overlapTokens?: number;
}

export interface SmartFileProfile {
    metadata: {
        filePath: string;
        relativePath: string;
        sizeBytes: number;
        lineCount: number;
        language: string | null;
        lastModified?: string; // ISO date string
        newlineStyle?: "lf" | "crlf" | "mixed";
        encoding?: string; // e.g., "utf-8"
        hasBOM?: boolean;
        usesTabs?: boolean;
        indentSize?: number | null;
        isConfigFile?: boolean;
        configType?: "tsconfig" | "package.json" | "lintrc" | "editorconfig" | "other";
        configScope?: "project" | "directory" | "file";
    };
    structure: {
        skeleton: string;
        symbols: SymbolInfo[];
        complexity?: {
            functionCount: number;
            linesOfCode: number;
            maxNestingDepth?: number;
        };
    };
    usage: {
        incomingCount: number;
        incomingFiles: string[];
        outgoingCount?: number;
        outgoingFiles?: string[];
        testFiles?: string[];
    };
    guidance: {
        bodyHidden: boolean;
        readFullHint: string;
        readFragmentHint: string;
        skeletonSummaryNote?: string;
    };
    versionInfo?: FileVersionInfo;
}
