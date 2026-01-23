import crypto from "crypto";
import type { ExploreItem, ExploreResponse } from "../pillars/explore/ResultFormatter.js";
import { truncate } from "../pillars/explore/ResultFormatter.js";
import type { TaskBudgetPolicy } from "../policy/McpModePresetRegistry.js";
import type { TaskEvidenceItem, TaskEvidencePack, TaskEvidenceSource } from "../../types/flow-artifacts.js";

const DOC_HEAVY_TOKENS = ["docs", "readme", "adr", ".md", "documentation"];

const createEvidencePackId = (): string => {
    const suffix = crypto.randomBytes(6).toString("hex");
    return `evidence_${Date.now().toString(36)}_${suffix}`;
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

const buildEvidenceItem = (item: ExploreItem, kind: "code" | "doc", maxExcerptChars: number): TaskEvidenceItem => {
    const excerptSource = typeof item.content === "string" ? item.content : (item.preview ?? "");
    const truncated = excerptSource.length > maxExcerptChars;
    const excerpt = truncate(excerptSource, maxExcerptChars);
    const anchorText = kind === "code"
        && !truncated
        && typeof item.content === "string"
        && item.content.length > 0
        ? item.content
        : undefined;
    return {
        filePath: item.filePath,
        kind,
        source: resolveEvidenceSource(item),
        excerpt,
        reason: reasonForItem(item),
        score: typeof item.score === "number" ? item.score : undefined,
        truncated,
        ...(anchorText ? { anchorText } : {}),
        ...(item.range?.startLine || item.range?.endLine
            ? { location: { lineStart: item.range?.startLine, lineEnd: item.range?.endLine } }
            : {})
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
        evidence.push(buildEvidenceItem(sortedCode[0], "code", maxExcerptChars));
    }
    if (isDocumentationHeavy(args.request, args.intentCategory) && sortedDocs[0]) {
        evidence.push(buildEvidenceItem(sortedDocs[0], "doc", maxExcerptChars));
    }
    for (const item of sortedCode.slice(1)) {
        if (evidence.length >= args.budgetPolicy.maxEvidenceItems) break;
        evidence.push(buildEvidenceItem(item, "code", maxExcerptChars));
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
