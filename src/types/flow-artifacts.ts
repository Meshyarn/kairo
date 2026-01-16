import type { SuggestedActionV1 } from "./guidance.js";

export type ResearchPackId = string;

export interface TopModule {
    path: string;
    score: number;
    why: string[];
    fileCount?: number;
    exportCount?: number;
}

export interface Edge {
    from: string;
    to: string;
    type: "import" | "extends" | "implements" | "uses" | "calls";
    weight?: number;
}

export interface ProjectSketch {
    summary: string;
    topModules: TopModule[];
    edgesSample: Edge[];
    ascii?: string;
    mermaid?: string;
    degraded?: boolean;
    view?: "full" | "layers" | "domains";
    layersSummary?: {
        layers: Array<{
            name: string;
            modules: string[];
            dependsOn: string[];
        }>;
    };
    domainsSummary?: {
        domains: Array<{
            name: string;
            modules: string[];
            sharedWith: string[];
        }>;
    };
}

export interface ResearchPack {
    id: ResearchPackId;
    sketch: ProjectSketch;
    hotspots?: Array<{ path: string; reason: string; score: number }>;
    boundaries?: Array<{ name: string; modules: string[]; external: string[] }>;
    createdAt: number;
    expiresAt?: number;
}

export type AnalysisPackId = string;

export interface AnalysisCluster {
    id: string;
    label: string;
    files: Array<{ path: string; score?: number; role?: string }>;
    boundaries?: { incoming: string[]; outgoing: string[] };
    rationale: string[];
}

export interface AnalysisPack {
    id: AnalysisPackId;
    goal: string;
    clusters: AnalysisCluster[];
    createdAt: number;
    degraded?: boolean;
}

export type StylePackId = string;

export interface CodeStyle {
    indent: "spaces" | "tabs";
    indentSize: number;
    quotes: "single" | "double";
    semicolons: boolean;
    lineEndings: "lf" | "crlf";
    trailingComma?: boolean;
    maxLineLength?: number;
    braceStyle?: "1tbs" | "allman" | "stroustrup";
}

export interface PatternSet {
    imports: Array<{
        module: string;
        style: "named" | "default" | "namespace" | "side-effect";
        count: number;
        example?: string;
    }>;
    naming: Array<{
        type: "class" | "function" | "variable" | "constant" | "file" | "directory";
        convention: "camelCase" | "PascalCase" | "snake_case" | "SCREAMING_SNAKE" | "kebab-case";
        confidence: number;
        examples?: string[];
    }>;
    fileOrg: {
        fileNamePattern: string;
        directoryPattern: string;
        testPattern?: string;
        indexPattern?: "barrel" | "none" | "mixed";
    };
    exports?: Array<{
        style: "default" | "named" | "namespace";
        exportedNames: string[];
        count: number;
    }>;
    affixes?: {
        prefixes: string[];
        suffixes: string[];
    };
    errorHandling?: {
        style: "try-catch" | "result-type" | "callback" | "mixed";
        customErrorClass?: boolean;
    };
}

export interface NormClaim {
    claim: string;
    source: string;
    sourceType: "adr" | "readme" | "contributing" | "comment" | "config";
    confidence: number;
    keywords?: string[];
}

export interface VibeProfile {
    codeStyle: CodeStyle;
    patterns: PatternSet;
    norms?: NormClaim[];
    confidence: "low" | "medium" | "high";
}

export interface StylePack {
    id: StylePackId;
    profile: VibeProfile;
    scope: string;
    createdAt: number;
    expiresAt?: number;
    localOverrides?: Array<{ glob: string; profile: Partial<VibeProfile>; reason?: string }>;
}

export type DraftPackId = string;

export interface SkeletonCode {
    content: string;
    signatures: Array<{
        name: string;
        type: "function" | "class" | "method" | "interface" | "type";
        signature: string;
        lineStart: number;
        lineEnd: number;
    }>;
    structure: {
        imports: string[];
        exports: string[];
        dependencies: string[];
    };
    placeholders: Array<{
        line: number;
        description: string;
    }>;
}

export interface PhantomFile {
    path: string;
    content: string;
    isNew: boolean;
    language: string;
}

export interface PhantomDiff {
    path: string;
    hunks: Array<{
        oldStart: number;
        oldLines: number;
        newStart: number;
        newLines: number;
        lines: string[];
    }>;
    summary: string;
    additions: number;
    deletions: number;
}

export interface ImpactAnalysis {
    directlyAffected: string[];
    potentiallyAffected: string[];
    breakingChanges: Array<{
        type: "signature" | "export" | "type" | "behavior";
        description: string;
        affectedFiles: string[];
    }>;
    testFiles: string[];
}

export interface PreflightCheck {
    syntaxValid: boolean;
    typesResolvable: boolean;
    guardrailsPassed: boolean;
    warnings: string[];
}

export interface DraftPack {
    id: DraftPackId;
    intent: string;
    skeleton: SkeletonCode | PhantomDiff[];
    phantomFiles: PhantomFile[];
    phantomDiffs?: PhantomDiff[];
    changePlan?: any;
    impactAnalysis?: ImpactAnalysis;
    fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
    preflightCheck: PreflightCheck;
    stylePack?: StylePack;
    workflowMeta?: WorkflowMeta;
    createdAt: number;
    status: "pending" | "approved" | "rejected" | "applied";
}

export type WorkflowConfidence = "high" | "medium" | "low";

export interface WorkflowMeta {
    confidence: WorkflowConfidence;
    reasons: string[];
    workflowStatus: {
        hasResearch: boolean;
        hasAnalysis: boolean;
        hasStylePack: boolean;
        dryRunUsed: boolean;
    };
}

export type Verdict = "pass" | "warn" | "block";

export interface SyntaxValidation {
    verdict: Verdict;
    diagnostics: Array<{
        file: string;
        line: number;
        column: number;
        message: string;
        severity: "error" | "warning";
        rule?: string;
    }>;
    summary: string;
}

export interface SemanticValidation {
    verdict: Verdict;
    diagnostics: Array<{
        file: string;
        line: number;
        column: number;
        message: string;
        code: string | number;
        severity: "error" | "warning" | "info";
    }>;
    unresolvedImports?: string[];
    typeErrors?: number;
    summary: string;
}

export interface GuardrailsValidation {
    verdict: Verdict;
    checks: {
        cycleDetection?: {
            passed: boolean;
            newCycles?: Array<{ path: string[]; severity: "warning" | "error" }>;
        };
        coreProtection?: {
            passed: boolean;
            violations?: Array<{ file: string; rule: string; message: string }>;
        };
        protocolCompliance?: {
            passed: boolean;
            violations?: Array<{ protocol: string; file: string; message: string }>;
        };
        publicSurface?: {
            passed: boolean;
            breakingChanges?: Array<{ type: string; symbol: string; message: string }>;
        };
    };
    blockingErrors: string[];
    warnings: string[];
    summary: string;
}

export interface VibeAlignmentValidation {
    verdict: Verdict;
    score: number;
    breakdown: {
        formatting: { score: number; issues: string[] };
        naming: { score: number; issues: string[] };
        imports: { score: number; issues: string[] };
        patterns: { score: number; issues: string[] };
    };
    deviations: Array<{
        file: string;
        line?: number;
        expected: string;
        actual: string;
        category: "format" | "naming" | "import" | "pattern";
        severity: "minor" | "major";
    }>;
    summary: string;
}

export type SuggestedAction = SuggestedActionV1;

export type ReviewReportId = string;

export interface ReviewReport {
    id: ReviewReportId;
    verdict: Verdict;
    syntax?: SyntaxValidation;
    semantic?: SemanticValidation;
    guardrails?: GuardrailsValidation;
    vibeAlignment?: VibeAlignmentValidation;
    suggestedActions: SuggestedAction[];
    reviewedAt: number;
    reviewedFiles: string[];
}

export type ArtifactType = "research" | "analysis" | "style" | "draft" | "review";
export type ArtifactId = ResearchPackId | AnalysisPackId | StylePackId | DraftPackId | ReviewReportId;

export interface FlowArtifactBase {
    id: ArtifactId;
    type: ArtifactType;
    createdAt: number;
    expiresAt?: number;
    sessionId?: string;
    parentId?: string;
    metadata?: Record<string, any>;
}

export interface ResearchArtifact extends FlowArtifactBase {
    type: "research";
    pack: ResearchPack;
}

export interface AnalysisArtifact extends FlowArtifactBase {
    type: "analysis";
    pack: AnalysisPack;
}

export interface StyleArtifact extends FlowArtifactBase {
    type: "style";
    pack: StylePack;
}

export interface DraftArtifact extends FlowArtifactBase {
    type: "draft";
    pack: DraftPack;
}

export interface ReviewArtifact extends FlowArtifactBase {
    type: "review";
    report: ReviewReport;
    targetDraftId?: DraftPackId;
}

export type FlowArtifact =
    | ResearchArtifact
    | AnalysisArtifact
    | StyleArtifact
    | DraftArtifact
    | ReviewArtifact;

export interface ArtifactManagerStatus {
    totalCount: number;
    byType: Record<ArtifactType, number>;
    oldestAt: number;
    newestAt: number;
    cacheUtilization: number;
}

export type FlowSessionStatus = "active" | "completed" | "abandoned";

export type ToolProfile = "lean" | "fast" | "balanced" | "deep";
export type ToolSources = "code" | "docs" | "both";
export type ToolSafety = "plan" | "apply";

export interface SessionPolicy {
    profile?: ToolProfile;
    sources?: ToolSources;
    safety?: ToolSafety;
    explore?: { profile?: ToolProfile; sources?: ToolSources };
    understand?: { profile?: ToolProfile; sources?: ToolSources };
    write?: { profile?: ToolProfile; safety?: ToolSafety };
    change?: { profile?: ToolProfile; safety?: ToolSafety };
}

export interface FlowSessionOutcome {
    filesCreated: string[];
    filesModified: string[];
    finalReviewId?: ReviewReportId;
}

export interface FlowSession {
    id: string;
    startedAt: number;
    intent: string;
    status: FlowSessionStatus;
    artifacts: {
        research?: ResearchPackId;
        analysis?: AnalysisPackId;
        style?: StylePackId;
        drafts: DraftPackId[];
        reviews: ReviewReportId[];
    };
    updatedAt?: number;
    outcome?: FlowSessionOutcome;
    policy?: SessionPolicy;
}
