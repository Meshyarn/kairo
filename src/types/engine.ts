import type { ValidationDiagnostic, ValidationSummary } from "./validation.js";

export interface ReadFragmentResult {
    filePath: string;
    content: string;
    ranges: LineRange[];
    versionInfo?: FileVersionInfo;
}

export interface LineRange {
    start: number;
    end: number;
}

export interface ErrorDetails {
    conflictingLines?: number[];
    diagnostics?: ValidationDiagnostic[];
}

export interface IndexRange {
    start: number;
    end: number;
}

export type NormalizationLevel =
    | "exact"
    | "line-endings"
    | "trailing"
    | "indentation"
    | "whitespace"
    | "structural";

export interface NormalizationConfig {
    /** Number of spaces that represent a tab when normalizing indentation. */
    tabWidth?: number;
    /** Whether to preserve indentation when collapsing whitespace. Defaults to true. */
    preserveIndentation?: boolean;
}

export type ContextFuzziness = "strict" | "normal" | "loose";

export type SafetyLevel = "strict" | "normal" | "force";

export interface MatchConfidence {
    /** Confidence score between 0 (no confidence) and 1 (perfect confidence). */
    score: number;
    /** Strategy that produced the match. */
    matchType: "exact" | "normalization" | "whitespace-fuzzy" | "levenshtein";
    /** Normalization level that was active when the match was found. */
    normalizationLevel: NormalizationLevel;
    /** Boost applied when before/after context matched. */
    contextBoost: number;
    /** Boost applied when a lineRange constrained the search. */
    lineRangeBoost: number;
    /** Boost applied when indexRange constrained the search. */
    indexRangeBoost?: number;
    /** Textual explanation that can be surfaced to users. */
    reason?: string;
}

export interface Edit {
    /** Natural language description of what to edit (for embedding-based search) */
    intent?: string;
    targetString: string;
    replacementString: string;
    lineRange?: LineRange;
    /**
     * Optional absolute character range within the file content.
     * When provided, editors can perform precise, index-based replacements
     * without needing fuzzy search or context matching.
     */
    indexRange?: IndexRange;
    beforeContext?: string;
    afterContext?: string;
    fuzzyMode?: "whitespace" | "levenshtein";
    anchorSearchRange?: { lines: number, chars: number };
    /** Highest normalization tier the editor should consider. Defaults to "exact". */
    normalization?: NormalizationLevel;
    /** Fine-grained options for normalization attempts (tab width, indentation preservation, etc.) */
    normalizationConfig?: NormalizationConfig;
    /** NEW: Explicit escape handling mode. Defaults to 'literal'. */
    escapeMode?: "literal" | "interpreted";
    /** Optional hash guard for the original content to catch drift before editing. */
    expectedHash?: {
        algorithm: "sha256" | "xxhash";
        value: string;
    };
    /** Controls normalization strictness for context matching. Defaults to "normal". */
    contextFuzziness?: ContextFuzziness;
    /** Optional insert semantics for smarter placement-based edits. */
    insertMode?: "before" | "after" | "at";
    /** Line hint for insertMode === "at" (uses start as the target line). */
    insertLineRange?: { start: number };
}

export type DiffMode = "myers" | "semantic";

export interface EditExecutionOptions {
    diffMode?: DiffMode;
    skipImpactPreview?: boolean;
}

export type SemanticChangeType = "add" | "remove" | "modify" | "move" | "rename";

export interface SemanticChange {
    type: SemanticChangeType;
    symbolType?: string;
    name: string;
    oldName?: string;
    similarity?: number;
    oldLocation?: LineRange;
    newLocation?: LineRange;
    summary?: string;
}

export interface SemanticDiffSummary {
    changes: SemanticChange[];
    stats: {
        added: number;
        removed: number;
        modified: number;
        renamed: number;
        moved: number;
    };
}

export interface SemanticDiffProvider {
    diff(filePath: string, oldContent: string, newContent: string): Promise<SemanticDiffSummary | undefined>;
}

export interface ToolSuggestion {
    toolName: string;
    rationale: string;
    exampleArgs?: Record<string, unknown>;
    priority?: "high" | "medium" | "low";
}

export interface EnhancedErrorDetails {
    similarSymbols?: string[];
    similarFiles?: string[];
    nextActionHint?: string;
    toolSuggestions?: ToolSuggestion[];
    context?: Record<string, any>;
}

export type ImpactRiskLevel = "low" | "medium" | "high";

export interface CrossLangFieldUsage {
    filePath: string;
    line: number;
    column: number;
    propertyChain: string[];
}

export interface CrossLangFieldImpact {
    exportName: string;
    fieldName: string;
    usages: CrossLangFieldUsage[];
}

export interface CrossLangImpact {
    packageName: string;
    consumerFiles: string[];
    changedExports: string[];
    breakingExports?: string[];
    nonBreakingExports?: string[];
    degraded: boolean;
    reasons?: string[];
    fieldImpacts?: CrossLangFieldImpact[];
}

export interface ImpactPreview {
    filePath: string;
    riskLevel: ImpactRiskLevel;
    summary: {
        incomingCount: number;
        outgoingCount: number;
        impactedFiles: string[];
    };
    editCount: number;
    suggestedTests?: string[];
    notes?: string[];
    crossLangImpact?: CrossLangImpact;
}

export interface BatchEditGuidance {
    clusters: Array<{ files: string[]; reason: string }>;
    companionSuggestions: Array<{ filePath: string; reason: string }>;
    opportunities?: BatchOpportunity[];
}

export interface MatchDiagnostics {
    attempts: {
        mode: string;
        candidates: { line: number; snippet: string; score?: number }[];
        failureReason: string;
    }[];
}

export interface EditResult {
    success: boolean;
    message?: string;
    diff?: string;
    structuredDiff?: { filePath: string; diff: string; added: number; removed: number }[];
    originalContent?: string;
    newContent?: string;
    semanticSummary?: SemanticDiffSummary;
    diffModeUsed?: DiffMode;
    details?: ErrorDetails;
    suggestion?: ToolSuggestion;
    errorCode?: string;
    warnings?: string[];
    validationSummary?: ValidationSummary;
    impactPreview?: ImpactPreview;
    impactPreviews?: ImpactPreview[];
    batchGuidance?: BatchEditGuidance;
    /**
     * Metadata about the edit operation, including inverse edits for undo.
     */
    operation?: EditOperation;
}

export interface FileOperation {
    /**
     * Marker for non-edit filesystem operations stored in history.
     */
    type: "file";
    /**
     * Unique identifier for this operation (UUID).
     */
    id: string;
    /**
     * Milliseconds since epoch when the operation was created.
     */
    timestamp: number;
    /**
     * Human-readable description of the operation (e.g. tool name or intent).
     */
    description: string;
    /**
     * The file this operation applies to, typically stored
     * as a path relative to the SmartContextServer root.
     */
    filePath: string;
    /**
     * The filesystem action represented by this operation.
     */
    action: "create" | "delete";
    /**
     * Content required to restore or recreate the file.
     */
    content?: string;
}

export type HistoryOperation = EditOperation | FileOperation;

export interface SuggestedBatchEdit {
    operation: "insert" | "replace" | "delete";
    insertMode?: "before" | "after" | "at";
    targetHint?: string;
    replacementTemplate?: string;
}

export interface BatchOpportunity {
    type: "add_import" | "add_trait" | "other";
    description: string;
    affectedFiles: string[];
    supportingFiles?: string[];
    confidence: number;
    suggestedEdit?: SuggestedBatchEdit;
    notes?: string[];
}

export interface EditOperation {
    /**
     * The file this operation applies to, typically stored
     * as a path relative to the SmartContextServer root.
     */
    filePath?: string;
    /**
     * Unique identifier for this edit operation (UUID).
     */
    id: string;
    /**
     * Milliseconds since epoch when the operation was created.
     */
    timestamp: number;
    /**
     * Human-readable description of the operation (e.g. tool name or intent).
     */
    description: string;
    /**
     * The original edits that were applied to the file.
     */
    edits: Edit[];
    /**
     * The inverse edits that can be used to undo this operation.
     */
    inverseEdits: Edit[];
}

export interface BatchOperation {
    id: string;
    timestamp: number;
    description: string;
    operations: HistoryOperation[];
}

export type HistoryItem = EditOperation | FileOperation | BatchOperation;

export interface DirectoryTree {
    [key: string]: null | DirectoryTree;
}

export type ReadCodeView = "full" | "skeleton" | "fragment";

export type SkeletonDetailLevel = "minimal" | "standard" | "detailed";

export interface SkeletonOptions {
    /** Include member variables and class attributes when true. Defaults to true. */
    includeMemberVars?: boolean;
    /** Include line/comment blocks when true. Defaults to false. */
    includeComments?: boolean;
    /** Include semantic summaries (calls/refs) in folded blocks. Defaults to false. */
    includeSummary?: boolean;
    /** Use block-comment placeholders in folded blocks when true. Defaults to false. */
    useCommentPlaceholder?: boolean;
    /** Controls folding strictness for method bodies and large regions. */
    detailLevel?: SkeletonDetailLevel;
    /** Maximum literal entries to show when previewing member arrays. Defaults to 3. */
    maxMemberPreview?: number;
}

export interface ReadCodeArgs {
    filePath: string;
    view?: ReadCodeView;
    lineRange?: string;
    skeletonOptions?: SkeletonOptions;
}

export interface FileVersionInfo {
    version: number;
    contentHash: string;
    lastModified: number;
    encoding: "utf-8";
    lineEnding: "lf" | "crlf";
}

export interface ReadCodeResult {
    content: string;
    metadata: {
        lines: number;
        language: string | null;
        path: string;
    };
    truncated: boolean;
    versionInfo?: FileVersionInfo;
}

export interface EditCodeEdit {
    filePath: string;
    operation: "replace" | "create" | "delete";
    targetString?: string;
    replacementString?: string;
    lineRange?: LineRange;
    beforeContext?: string;
    afterContext?: string;
    fuzzyMode?: "whitespace" | "levenshtein";
    anchorSearchRange?: { lines: number; chars: number };
    indexRange?: IndexRange;
    normalization?: NormalizationLevel;
    normalizationConfig?: NormalizationConfig;
    expectedHash?: Edit["expectedHash"];
    confirmationHash?: string;
    safetyLevel?: SafetyLevel;
    contextFuzziness?: ContextFuzziness;
    insertMode?: "before" | "after" | "at";
    insertLineRange?: { start: number };
}

export interface RefactoringContext {
    pattern?: "rename-symbol" | "move-function" | "extract-component" | "inline-variable";
    scope?: "file" | "directory" | "project";
    estimatedEdits?: number;
}

export interface EditCodeArgs {
    edits: EditCodeEdit[];
    dryRun?: boolean;
    createMissingDirectories?: boolean;
    ignoreMistakes?: boolean;
    diffMode?: DiffMode;
    refactoringContext?: RefactoringContext;
    options?: {
        applyMode?: "atomic" | "partial";
        deleteMode?: "forbid" | "confirm";
        ordering?: "stable" | "creates_first";
    };
    fileVersions?: Record<string, {
        expectedVersion?: number;
        expectedHash?: string;
    }>;
}

export interface EditCodeResultEntry {
    filePath: string;
    operation?: "replace" | "create" | "delete";
    applied: boolean;
    status?: "applied" | "dry_run_ok" | "failed" | "blocked" | "confirmation_required";
    error?: string;
    errorCode?: string;
    diff?: string;
    requiresConfirmation?: boolean;
    confirmationHint?: { algorithm: "sha256"; valueFormat: "hex"; rationale: string };
    fileSize?: number;
    lineCount?: number;
    contentPreview?: string;
    hashMismatch?: boolean;
    nextActionHint?: NextActionHint;
}

export interface EditCodeResult {
    success: boolean;
    status?: "success" | "partial_success" | "blocked" | "failed";
    results: EditCodeResultEntry[];
    transactionId?: string;
    warnings?: string[];
    message?: string;
    errorCode?: string;
    summary?: { planned: number; applied: number; failed: number; blocked: number; confirmationRequired: number };
    updatedFileStates?: Record<string, {
        newVersion: number;
        newHash: string;
        affectedLineRange?: LineRange;
    }>;
}

export interface NextActionHint {
    suggestReRead: boolean;
    modifiedContent?: string;
    affectedLineRange?: LineRange;
}

export interface GetBatchGuidanceArgs {
    filePaths: string[];
    pattern?: string;
}

// ADR-042-005: Phase A1 - Resolver Types
export interface ResolvedEdit {
    filePath: string; // relative path (history/ops 호환)
    indexRange: { start: number; end: number };
    targetString: string; // 해당 indexRange의 실제 slice (Editor.ts 검증용)
    expectedHash?: { algorithm: "xxhash" | "sha256"; value: string };
    replacementString: string;
    diagnostics?: {
        resolvedBy: "indexRange" | "lineRange" | "context" | "ast" | "fuzzy" | "embedding";
        candidateCount?: number;
        timingMs?: number;
        notes?: string[];
    };
}

export interface ResolveError {
    filePath: string;
    editIndex: number;
    errorCode: "NO_MATCH" | "AMBIGUOUS_MATCH" | "HASH_MISMATCH" | "INVALID_RANGE" | "RESOLVE_TIMEOUT" | "LEVENSHTEIN_BLOCKED";
    message: string;
    suggestion?: {
        tool?: "read" | "change";
        lineRange?: { start: number; end: number };
        indexRange?: { start: number; end: number };
        next?: string;
    };
}

export interface ResolveResult {
    success: boolean;
    resolvedEdits?: ResolvedEdit[];
    errors?: ResolveError[];
}

export interface ResolveOptions {
    allowAmbiguousAutoPick?: boolean;
    timeoutMs?: number;
    /** Enable embedding-based symbol search (ADR-042-006 Phase 1) */
    smartMatch?: boolean;
}
