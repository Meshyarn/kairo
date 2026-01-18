export type ValidationMode = "off" | "warn" | "error";

export interface ValidationConfig {
    syntax: ValidationMode;
    semantic: ValidationMode;
    lspDiagnostics: ValidationMode;
    timeoutMs: number;
}

export interface ValidationDiagnostic {
    filePath: string;
    line?: number;
    column?: number;
    message: string;
    code?: string;
    provider: "syntax" | "semantic" | "lsp";
    severity: "error" | "warning";
    snippet?: string;
}

export interface ValidationResult {
    success: boolean;
    blockingErrors?: ValidationDiagnostic[];
    warnings?: ValidationDiagnostic[];
    durationMs?: number;
    languageId?: string;
    supportLevel?: "L2" | "L3";
}

export interface ValidationSummary {
    success: boolean;
    blockingErrors: ValidationDiagnostic[];
    warnings: ValidationDiagnostic[];
    durationMs: number;
    syntaxChecked: boolean;
    semanticChecked: boolean;
}
