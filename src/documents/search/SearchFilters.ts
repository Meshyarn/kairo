import * as path from "path";

export function isCodeFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".py";
}

export function buildDocScopeGlobs(
    scope: "docs" | "project" | "all",
    includeComments: boolean,
    includeLogs: boolean,
    includeMetrics: boolean
): string[] {
    let includeGlobs: string[];
    if (scope === "docs") {
        includeGlobs = [
            "docs/**/*.md",
            "docs/**/*.mdx",
            "docs/**/README",
            "docs/**/README.*",
            "**/README",
            "**/README.*"
        ];
    } else if (scope === "project") {
        includeGlobs = [
            "**/*.md",
            "**/*.mdx",
            "**/README",
            "**/README.*"
        ];
    } else {
        includeGlobs = [
            "**/*.md",
            "**/*.mdx",
            "**/*.txt",
            "**/*.log",
            "**/*.docx",
            "**/*.xlsx",
            "**/*.pdf",
            "**/*.html",
            "**/*.htm",
            "**/*.css",
            "**/README",
            "**/LICENSE",
            "**/NOTICE",
            "**/CHANGELOG",
            "**/CODEOWNERS",
            "**/.gitignore",
            "**/.mcpignore",
            "**/.editorconfig"
        ];
    }

    if (includeLogs && scope !== "all") {
        includeGlobs.push("**/*.log", "**/*.txt");
    }
    if (includeMetrics) {
        includeGlobs.push(
            "**/*.csv",
            "**/*.json",
            "**/*.ndjson",
            "**/metrics/**/*.csv",
            "**/metrics/**/*.json",
            "**/metrics/**/*.ndjson",
            "**/monitoring/**/*.csv",
            "**/monitoring/**/*.json",
            "**/monitoring/**/*.ndjson",
            "**/*metrics*.csv",
            "**/*metrics*.json",
            "**/*metrics*.ndjson"
        );
    }
    if (includeComments) {
        includeGlobs.push("**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py");
    }

    return includeGlobs;
}

export function matchesDocScope(
    filePath: string,
    scope: "docs" | "project" | "all",
    includeComments: boolean,
    includeLogs: boolean,
    includeMetrics: boolean
): boolean {
    if (!filePath) return false;
    const normalized = filePath.replace(/\\/g, "/");
    if (includeComments && isCodeFile(normalized)) return true;
    if (scope === "all") return true;
    if (isReadmePath(normalized)) return true;
    if (includeLogs && isLogPath(normalized)) return true;
    if (includeMetrics && isMetricsPath(normalized)) return true;
    if (!isMarkdownPath(normalized)) return false;
    if (scope === "docs") return isDocsPath(normalized);
    return true;
}

function isMarkdownPath(filePath: string): boolean {
    return /\.(md|mdx)$/i.test(filePath);
}

function isReadmePath(filePath: string): boolean {
    const base = filePath.split("/").pop() ?? "";
    return /^readme(\.|$)/i.test(base);
}

function isLogPath(filePath: string): boolean {
    return /\.log$/i.test(filePath) || /\/logs?\//i.test(filePath);
}

export function isMetricsPath(filePath: string): boolean {
    if (/\.(csv|json|ndjson)$/i.test(filePath)) return true;
    const base = filePath.split("/").pop() ?? "";
    return /metrics?/i.test(base);
}

function isDocsPath(filePath: string): boolean {
    return filePath.startsWith("docs/") || filePath.includes("/docs/");
}
