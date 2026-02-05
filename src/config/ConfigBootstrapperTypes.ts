export type BootstrapMode = "plan" | "apply";
export type BootstrapTarget =
    | "kairo"
    | "vscode"
    | "host_snippets"
    | "host_codex"
    | "host_claude_cli"
    | "host_gemini_cli";
export type HostPreset = "minimal" | "recommended";

export type ConfigWriteOp = {
    op: "create" | "update" | "noop" | "mkdir";
    path: string;
    content?: string;
    patch?: {
        beforeHash?: string;
        jsonMerge?: Record<string, unknown>;
        removeKeys?: string[];
    };
    reason?: string;
};

export type ConfigFinding = {
    code: string;
    severity: "info" | "warn" | "error";
    message: string;
    action?: string;
    evidence?: Record<string, unknown>;
};

export type RepoSummary = {
    id: string;
    path: string;
    name: string;
    type: "primary" | "linked" | "reference";
    languages: string[];
    allowCrossRepoEdits?: boolean;
    excludePatterns?: string[];
};

export type LanguageShare = {
    languageId: string;
    supportLevel?: "L2" | "L3";
    share: number;
};

export type BootstrapDetected = {
    root: string;
    repos: RepoSummary[];
    languages: LanguageShare[];
    wasm: {
        required: string[];
        found: string[];
        missing: string[];
        suggestedWasmDir?: string;
    };
};

export type BootstrapApplyResult = {
    path: string;
    op: ConfigWriteOp["op"];
    success: boolean;
    message: string;
};

export type ManageInitArgs = {
    mode?: BootstrapMode;
    targets?: BootstrapTarget[];
    root?: string;
    multiRepo?: "auto" | "single" | "detect";
    presets?: HostPreset;
    languageScan?: {
        maxFiles?: number;
        sampleBytesPerFile?: number;
        includeDocs?: boolean;
    };
    applyOptions?: {
        backup?: boolean;
        legacyMcpConfig?: boolean;
    };
};

export type ManageDoctorArgs = {
    mode?: BootstrapMode;
    scope?: "project" | "config" | "languages" | "wasm" | "host" | "contracts" | "parity" | "capabilities";
    root?: string;
};

export type ManageBootstrapResult = {
    success: boolean;
    status: "ok" | "degraded" | "needs_action";
    summary: string;
    detected: BootstrapDetected;
    findings: ConfigFinding[];
    plan: ConfigWriteOp[];
    hints: string[];
    applied?: BootstrapApplyResult[];
};
