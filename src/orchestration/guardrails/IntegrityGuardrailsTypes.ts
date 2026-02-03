import type { Edit } from "../../types.js";
import type { IndexSnapshot, IndexStateManager } from "../../indexing/IndexStateManager.js";
import type { DependencyGraph } from "../../ast/DependencyGraph.js";
import type { ImportInfo, ExportInfo } from "../../indexing/ProjectIndex.js";
import type { AstChange } from "../../ast/AstDiffEngine.js";

export type GuardrailStatus = "pass" | "warn" | "block";
export type LanguageParityMode = "strict" | "balanced" | "permissive";
export type GuardrailBlockPolicy = "none" | "warn_only" | "high_only" | "all";

export type GuardrailWarning = {
    type: string;
    severity: "low" | "medium" | "high";
    message: string;
    details?: Record<string, unknown>;
};

export type GuardrailViolation = {
    type: string;
    message: string;
    details?: Record<string, unknown>;
};

export type SafetyChecklistItem = {
    id: string;
    description: string;
    required: boolean;
    completed?: boolean;
    status?: string;
};

export type IntegrityGuardrailsResult = {
    status: GuardrailStatus;
    architecturalRisk?: Record<string, unknown>;
    architecturalWarnings?: string[];
    warnings?: GuardrailWarning[];
    violations?: GuardrailViolation[];
    safetyChecklist?: SafetyChecklistItem[];
    blockingErrors?: string[];
    errorCode?: string;
    blockedReason?: string;
    parityDegraded?: boolean;
    parityConfidence?: "low" | "medium";
    indexSnapshot?: IndexSnapshot;
};

export type LayerRulesConfig = {
    layers: Array<{ name: string; match: string[] }>;
    allow?: Array<{ from: string; to: string }>;
    deny?: Array<{ from: string; to: string }>;
};

export type IntegrityGuardrailsConfig = {
    enabled: boolean;
    layerRules?: LayerRulesConfig;
    coreProtection: {
        pageRankThreshold: number;
        incomingCountThreshold: number;
        blockPolicy: GuardrailBlockPolicy;
    };
    protocolProtection: {
        files: string[];
        forbiddenTokens: string[];
        allowlist?: Array<{ file: string; tokens: string[]; reason: string }>;
    };
    publicSurfaceMonitor: {
        enabled: boolean;
        impactThreshold: number;
        requireBatchRefactoring: boolean;
    };
    languageParity: {
        mode: LanguageParityMode;
        fallbackConfidence: "low" | "medium";
    };
    performance: {
        pageRankCacheTTL: number;
    };
};

export type GuardrailContext = {
    targetPath: string;
    oldContent?: string | null;
    newContent?: string | null;
    edits?: Edit[];
    dependencyGraph?: DependencyGraph;
    indexStateManager?: IndexStateManager;
    constraints?: any;
    runTool?: (tool: string, args: any) => Promise<any>;
    applyMode?: boolean;
};

export type ParityResult = {
    degraded: boolean;
    blocked: boolean;
    confidence?: "low" | "medium";
};

export type ImportExtractionResult = {
    imports: ImportInfo[];
    parity: ParityResult;
};

export type ExportExtractionResult = {
    exports: ExportInfo[];
    parity: ParityResult;
};

export type PublicSurfaceResult = {
    hasChanges: boolean;
    changes: Array<{ type: "added" | "removed" | "modified"; name: string; exportType: string }>;
    impacts: Array<{ name: string; impactCount: number; impactedFiles: string[] }>;
    totalImpact: number;
    requiresBatchRefactoring: boolean;
    riskLevel: "low" | "medium" | "high";
    breakingChanges?: AstChange[];
    parity?: ParityResult;
};
