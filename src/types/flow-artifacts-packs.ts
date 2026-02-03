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

export type GraphPackId = string;

export interface GraphPack {
    id: GraphPackId;
    kind: "call_graph";
    source: { filePath: string; symbolName?: string; depth?: string };
    raw?: {
        nodes: Array<{ id: string; type: string; path?: string; label?: string }>;
        edges: Array<{ source: string; target: string; relation?: string }>;
        resolvedTarget?: any;
    };
    summary: {
        mode: "symbol" | "file";
        truncated: boolean;
        truncatedReason?: "cap" | "depth" | "unknown";
        totalNodes?: number;
        totalEdges?: number;
        topNodes?: Array<{ label: string; filePath?: string; degree?: number }>;
    };
    meta: {
        createdAt: number;
        totalNodes?: number;
        totalEdges?: number;
        truncatedByCap?: boolean;
        truncatedReason?: "cap" | "depth" | "unknown";
        caps?: { maxNodes?: number; maxEdges?: number };
    };
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
    references?: StylePackReference[];
    configDetections?: StylePackConfigDetection[];
    confidence?: number;
    exceptions?: Array<{ glob: string; reason?: string }>;
}

export type StylePackReference = {
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    reason?: string;
};

export type StylePackConfigDetection = {
    kind: string;
    path: string;
    scope: "serviceRoot" | "repoRoot" | "workspaceRoot";
    details?: Record<string, unknown>;
};

export type DraftPackId = string;

export type EvidencePackId = string;

export type TaskEvidenceSource = "explore.preview" | "explore.full" | "explore.section" | "understand.summary";

export interface TaskEvidenceItem {
    filePath: string;
    kind: "code" | "doc";
    source: TaskEvidenceSource;
    excerpt: string;
    reason: string;
    score?: number;
    truncated?: boolean;
    anchorText?: string;
    location?: { lineStart?: number; lineEnd?: number };
}

export interface TaskEvidencePack {
    id: EvidencePackId;
    intent: string;
    createdAt: number;
    expiresAt?: number;
    rankedFiles: Array<{ filePath: string; reason: string; score?: number }>;
    fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
    evidence: TaskEvidenceItem[];
    relatedArtifacts?: Array<{ id: string; kind: string; detail: "summary" | "full" }>;
    continuation?: { reason: string; nextCalls: Array<{ tool: "task" | "manage"; args: Record<string, unknown> }> };
    caps?: { maxItems: number; maxExcerptChars: number; maxFiles: number };
    degraded?: boolean;
    degradedReasons?: any[];
}

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
