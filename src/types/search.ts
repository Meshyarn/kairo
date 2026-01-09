import type { ToolSuggestion } from "./engine.js";

export interface FileSearchResult {
    filePath: string;
    lineNumber: number;
    preview: string;
    score?: number;
    scoreDetails?: ScoreDetails;
    groupedMatches?: Array<{
        lineNumber: number;
        preview: string;
        score?: number;
        scoreDetails?: ScoreDetails;
    }>;
    matchCount?: number;
}

export interface SearchOptions {
    /** Forces whole-word matching when true. Defaults to substring search. */
    wordBoundary?: boolean;
    /** Forces explicit case handling. Defaults to smart-case literals (case-sensitive only when query has uppercase). */
    caseSensitive?: boolean;
    /** When true (default), lowercase-only queries match CamelCase targets (smart-case). */
    smartCase?: boolean;
}

export type BudgetProfile = "safe" | "balanced" | "deep";

export interface ResourceBudget {
    maxCandidates: number;
    maxFilesRead: number;
    maxBytesRead: number;
    maxParseTimeMs: number;
    maxGraphNodes?: number;
    profile: BudgetProfile;
}

export interface ResourceUsage {
    filesRead: number;
    bytesRead: number;
    parseTimeMs: number;
    candidates?: number;
    degraded?: boolean;
    reason?: string;
}

export type SearchFieldType = "symbol-definition" | "signature" | "exported-member" | "comment" | "code-body";

export interface ScoreDetails {
    contentScore?: number;
    filenameMultiplier?: number;
    depthMultiplier?: number;
    fieldWeight?: number;
    totalScore?: number;
    filenameMatchType?: "exact" | "partial" | "none";
    fieldType?: SearchFieldType;
    callGraphBoost?: number;
    type?: string;
    details?: Array<{ type: string; score: number }>;
}

export interface Document {
    id: string; // Document ID (e.g. filePath)
    text: string; // The text content of the document
    score: number; // BM25 score
    filePath?: string;
    scoreDetails?: ScoreDetails;
    fieldType?: SearchFieldType;
    symbolId?: string;
}

export interface FileMatch {
    path: string;
    matches: {
        line: number;
        text: string;
    }[];
}

export interface ISearchProvider {
    (pattern: string, options: { cwd: string; exclude?: string[]; include?: string[] }): Promise<FileMatch[]>;
}

export interface ScoutResult {
    matches: FileMatch[];
    truncated: boolean;
    errors: string[];
}

export type SearchProjectType = "auto" | "file" | "symbol" | "directory" | "filename";

export interface SearchProjectArgs {
    query: string;
    type?: SearchProjectType;
    maxResults?: number;
    fileTypes?: string[];
    snippetLength?: number;
    matchesPerFile?: number;
    groupByFile?: boolean;
    deduplicateByContent?: boolean;
    budget?: ResourceBudget;
}

export interface SearchProjectResultEntry {
    type: "file" | "symbol" | "directory" | "filename";
    path: string;
    score: number;
    context?: string;
    line?: number;
    groupedMatches?: FileSearchResult["groupedMatches"];
    matchCount?: number;
}

export interface SearchProjectResult {
    results: SearchProjectResultEntry[];
    inferredType?: "file" | "symbol" | "directory" | "filename";
    message?: string;
    suggestions?: ToolSuggestion[];
    nextActionHint?: string;
    degraded?: boolean;
    budget?: { used?: ResourceUsage } & Partial<ResourceBudget>;
}
