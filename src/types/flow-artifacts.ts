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
    preflightCheck: PreflightCheck;
    stylePack?: StylePack;
    createdAt: number;
    status: "pending" | "approved" | "rejected" | "applied";
}
