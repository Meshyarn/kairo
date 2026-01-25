import crypto from "crypto";
import type { ExploreItem, ExploreResponse } from "../pillars/explore/ResultFormatter.js";
import { truncate } from "../pillars/explore/ResultFormatter.js";
import type { TaskBudgetPolicy } from "../policy/McpModePresetRegistry.js";
import type { TaskEvidenceItem, TaskEvidencePack, TaskEvidenceSource } from "../../types/flow-artifacts.js";

const DOC_HEAVY_TOKENS = ["docs", "readme", "adr", ".md", "documentation"];
const SYMBOL_TOKEN_RE = /[A-Za-z_$][\w$]*/g;
const MAX_ANCHOR_CHARS = 2000;

const createEvidencePackId = (): string => {
    const suffix = crypto.randomBytes(6).toString("hex");
    return `evidence_${Date.now().toString(36)}_${suffix}`;
};

const extractSymbolTokens = (request: string): string[] => {
    const matches = request.match(SYMBOL_TOKEN_RE) ?? [];
    const unique = new Set<string>();
    for (const token of matches) {
        if (token.length < 4) continue;
        unique.add(token);
        if (unique.size >= 12) break;
    }
    return Array.from(unique);
};

const buildLineStarts = (content: string): number[] => {
    const starts = [0];
    for (let index = 0; index < content.length; index += 1) {
        if (content[index] === "\n") {
            starts.push(index + 1);
        }
    }
    return starts;
};

const extractAnchorSnippet = (args: {
    content: string;
    request: string;
    range?: { startLine?: number; endLine?: number };
}): { anchorText: string; location?: { lineStart?: number; lineEnd?: number } } | undefined => {
    const content = args.content;
    // `ResultFormatter.truncate()` adds a trailing ellipsis; treat that as non-exact.
    if (content.endsWith("…")) return undefined;
    const lineStarts = buildLineStarts(content);
    const totalLines = lineStarts.length;
    const lineEndIndex = (line: number) => (line + 1 < totalLines ? lineStarts[line + 1] : content.length);

    const clampLine = (line: number) => Math.max(0, Math.min(totalLines - 1, line));

    let matchLine = 0;
    if (args.range?.startLine) {
        matchLine = clampLine(args.range.startLine - 1);
    } else {
        const tokens = extractSymbolTokens(args.request);
        let matchIndex = -1;
        for (const token of tokens) {
            const index = content.indexOf(token);
            if (index >= 0) {
                matchIndex = index;
                break;
            }
        }
        if (matchIndex >= 0) {
            // Count '\n' occurrences before matchIndex.
            let line = 0;
            for (let index = 0; index < matchIndex && index < content.length; index += 1) {
                if (content[index] === "\n") line += 1;
            }
            matchLine = clampLine(line);
        }
    }

    let startLine = clampLine(matchLine - 3);
    let endLine = clampLine(matchLine + 3);
    if (args.range?.endLine) {
        endLine = clampLine(args.range.endLine - 1);
    }
    if (endLine < startLine) {
        const temp = startLine;
        startLine = endLine;
        endLine = temp;
    }

    let anchorText = content.slice(lineStarts[startLine], lineEndIndex(endLine));
    while (anchorText.length > MAX_ANCHOR_CHARS && endLine > startLine) {
        const trimEnd = (endLine - matchLine) >= (matchLine - startLine);
        if (trimEnd) {
            endLine -= 1;
        } else {
            startLine += 1;
        }
        anchorText = content.slice(lineStarts[startLine], lineEndIndex(endLine));
    }
    if (anchorText.length > MAX_ANCHOR_CHARS) {
        anchorText = anchorText.slice(0, MAX_ANCHOR_CHARS);
    }

    if (!anchorText.trim()) return undefined;
    return {
        anchorText,
        location: {
            lineStart: startLine + 1,
            lineEnd: endLine + 1
        }
    };
};

const isDocumentationHeavy = (request: string, intentCategory?: string): boolean => {
    if (intentCategory === "read" || intentCategory === "docs") return true;
    const lower = request.toLowerCase();
    return DOC_HEAVY_TOKENS.some((token) => lower.includes(token));
};

const resolveEvidenceSource = (item: ExploreItem): TaskEvidenceSource => {
    if (item.kind === "document_section") return "explore.section";
    if (item.kind === "file_full") return "explore.full";
    return "explore.preview";
};

const scoreItem = (item: ExploreItem): number => {
    return typeof item.score === "number" ? item.score : 0;
};

const reasonForItem = (item: ExploreItem): string => {
    if (Array.isArray(item.why) && item.why.length > 0) {
        return item.why[0];
    }
    if (item.kind === "document_section") return "Matched documentation section.";
    return "Matched relevant code.";
};

const buildEvidenceItem = (item: ExploreItem, kind: "code" | "doc", maxExcerptChars: number, request: string): TaskEvidenceItem => {
    const excerptSource = typeof item.content === "string" ? item.content : (item.preview ?? "");
    const truncated = excerptSource.length > maxExcerptChars;
    const excerpt = truncate(excerptSource, maxExcerptChars);
    const anchor = kind === "code" && typeof item.content === "string" && item.content.length > 0
        ? extractAnchorSnippet({ content: item.content, request, range: item.range })
        : undefined;
    return {
        filePath: item.filePath,
        kind,
        source: resolveEvidenceSource(item),
        excerpt,
        reason: reasonForItem(item),
        score: typeof item.score === "number" ? item.score : undefined,
        truncated,
        ...(anchor?.anchorText ? { anchorText: anchor.anchorText } : {}),
        ...(anchor?.location
            ? { location: anchor.location }
            : ((item.range?.startLine || item.range?.endLine)
                ? { location: { lineStart: item.range?.startLine, lineEnd: item.range?.endLine } }
                : {}))
    };
};

const buildRankedFiles = (items: ExploreItem[]) => {
    const ranked = items
        .filter((item) => typeof item.filePath === "string" && item.filePath.length > 0)
        .map((item) => ({
            filePath: item.filePath,
            reason: reasonForItem(item),
            score: typeof item.score === "number" ? item.score : undefined
        }))
        .sort((a, b) => {
            const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
            if (scoreDiff !== 0) return scoreDiff;
            return a.filePath.localeCompare(b.filePath);
        });
    const seen = new Set<string>();
    return ranked.filter((entry) => {
        if (seen.has(entry.filePath)) return false;
        seen.add(entry.filePath);
        return true;
    });
};

export const buildEvidencePackFromExplore = (args: {
    response: ExploreResponse;
    request: string;
    budgetPolicy: TaskBudgetPolicy;
    intentCategory?: string;
    fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
    relatedArtifacts?: Array<{ id: string; kind: string; detail: "summary" | "full" }>;
}): TaskEvidencePack => {
    const codeItems = Array.isArray(args.response?.data?.code) ? args.response.data.code : [];
    const docItems = Array.isArray(args.response?.data?.docs) ? args.response.data.docs : [];
    const rankedFiles = buildRankedFiles([...codeItems, ...docItems]).slice(0, args.budgetPolicy.maxEvidenceFiles);
    const evidence: TaskEvidenceItem[] = [];

    const maxExcerptChars = args.budgetPolicy.maxExcerptChars;
    const sortedCode = [...codeItems].sort((a, b) => scoreItem(b) - scoreItem(a));
    const sortedDocs = [...docItems].sort((a, b) => scoreItem(b) - scoreItem(a));

    if (sortedCode[0]) {
        evidence.push(buildEvidenceItem(sortedCode[0], "code", maxExcerptChars, args.request));
    }
    if (isDocumentationHeavy(args.request, args.intentCategory) && sortedDocs[0]) {
        evidence.push(buildEvidenceItem(sortedDocs[0], "doc", maxExcerptChars, args.request));
    }
    for (const item of sortedCode.slice(1)) {
        if (evidence.length >= args.budgetPolicy.maxEvidenceItems) break;
        evidence.push(buildEvidenceItem(item, "code", maxExcerptChars, args.request));
    }

    const createdAt = Date.now();
    return {
        id: createEvidencePackId(),
        intent: args.request,
        createdAt,
        rankedFiles,
        evidence: evidence.slice(0, args.budgetPolicy.maxEvidenceItems),
        ...(args.fileVersions ? { fileVersions: args.fileVersions } : {}),
        ...(args.relatedArtifacts ? { relatedArtifacts: args.relatedArtifacts } : {}),
        caps: {
            maxItems: args.budgetPolicy.maxEvidenceItems,
            maxExcerptChars,
            maxFiles: args.budgetPolicy.maxEvidenceFiles
        }
    };
};

export const buildEvidencePackFromUnderstand = (args: {
    primaryFile?: string;
    summary: string;
    request: string;
    budgetPolicy: TaskBudgetPolicy;
    relatedArtifacts?: Array<{ id: string; kind: string; detail: "summary" | "full" }>;
}): TaskEvidencePack => {
    const createdAt = Date.now();
    const filePath = args.primaryFile ?? "unknown";
    const excerpt = truncate(args.summary, args.budgetPolicy.maxExcerptChars);
    const evidence: TaskEvidenceItem[] = [
        {
            filePath,
            kind: "code",
            source: "understand.summary",
            excerpt,
            reason: "Analysis summary for primary target."
        }
    ];
    return {
        id: createEvidencePackId(),
        intent: args.request,
        createdAt,
        rankedFiles: filePath && filePath !== "unknown"
            ? [{ filePath, reason: "Primary file from analysis." }]
            : [],
        evidence,
        ...(args.relatedArtifacts ? { relatedArtifacts: args.relatedArtifacts } : {}),
        caps: {
            maxItems: args.budgetPolicy.maxEvidenceItems,
            maxExcerptChars: args.budgetPolicy.maxExcerptChars,
            maxFiles: args.budgetPolicy.maxEvidenceFiles
        }
    };
};
