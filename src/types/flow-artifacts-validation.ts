import type { SuggestedActionV1 } from "./guidance.js";
import type { DegradedReason } from "./tool-responses.js";

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
    degradedReasons?: DegradedReason[];
    stats?: {
        durationMs: number;
        nameLinkUsed?: boolean;
        contractGuard?: { mode: "spec_only" | "spec_plus_consumer_scan"; consumerScanUsed?: boolean };
        symbolic?: {
            enabled?: boolean;
            mode?: "off" | "warn" | "block_high" | "strict";
            queryUsed: boolean;
            solverUsed: boolean;
            constraintsBuilt?: number;
            pathsExplored?: number;
        };
    };
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
export type SchemaArtifactId = string;

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
