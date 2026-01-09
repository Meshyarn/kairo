import path from "path";
import type { HandlerContext } from "../HandlerContext.js";

export interface CodeHandlerDeps {
    context: HandlerContext;
    resolveRelativePath: (inputPath: string) => string;
    resolveAbsolutePath: (inputPath: string) => string;
}

export const createCodeHandlerDeps = (context: HandlerContext): CodeHandlerDeps => ({
    context,
    resolveRelativePath: (inputPath: string) => context.pathNormalizer.normalize(inputPath),
    resolveAbsolutePath: (inputPath: string) => context.pathNormalizer.toAbsolute(context.pathNormalizer.normalize(inputPath))
});

export const parseLineRanges = (raw?: string): Array<{ start: number; end: number }> => {
    if (!raw || typeof raw !== "string") return [];
    const ranges: Array<{ start: number; end: number }> = [];
    for (const part of raw.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(\d+)(?:\s*[-:]\s*(\d+))?$/);
        if (!match) continue;
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : start;
        if (Number.isFinite(start) && Number.isFinite(end)) {
            ranges.push({ start: Math.min(start, end), end: Math.max(start, end) });
        }
    }
    return ranges;
};

export const buildSkeletonFallback = (content: string, message?: string): string => {
    const header = `Skeleton generation failed: ${message ?? "Unknown error"}`;
    if (content.length <= 5000) {
        return `${header}\n${content}`;
    }
    const head = content.slice(0, 400);
    const tail = content.slice(-400);
    return `${header}\n--- Preview (start) ---\n${head}\n--- Preview (end) ---\n${tail}`;
};

export const inferDocumentKind = (
    filePath: string
): "markdown" | "mdx" | "html" | "css" | "text" | "unknown" => {
    const base = path.basename(filePath);
    if (base === "README" || base === "LICENSE" || base === "NOTICE" || base === "CHANGELOG" || base === "CODEOWNERS") {
        return "text";
    }
    if (base === ".gitignore" || base === ".mcpignore" || base === ".editorconfig") {
        return "text";
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".mdx") return "mdx";
    if (ext === ".md") return "markdown";
    if (ext === ".html" || ext === ".htm") return "html";
    if (ext === ".css") return "css";
    if (ext === ".txt" || ext === ".log") return "text";
    if (ext === ".docx") return "html";
    if (ext === ".xlsx") return "text";
    if (ext === ".pdf") return "text";
    return "unknown";
};
