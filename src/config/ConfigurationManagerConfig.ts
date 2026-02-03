import * as fs from "fs";
import * as path from "path";
import type { ValidationConfig, ValidationMode } from "../types/validation.js";
import { PathManager } from "../utils/PathManager.js";
import type { OverridePolicyConfig } from "./ConfigurationManagerTypes.js";

export const getEnvValue = (key: string, defaultValue?: any): any => {
    const envValue = process.env[key];
    if (envValue === undefined) {
        return defaultValue;
    }
    if (defaultValue === true || defaultValue === false) {
        return envValue === "true";
    }
    if (typeof defaultValue === "number") {
        const parsed = Number(envValue);
        return isNaN(parsed) ? defaultValue : parsed;
    }
    return envValue;
};

export const getEditorV2Enabled = (): boolean => {
    return getEnvValue("KAIRO_EDITOR_V2", false);
};

export const getEditorV2Mode = (): "off" | "dryrun" | "apply" => {
    const mode = getEnvValue("KAIRO_EDITOR_V2_MODE", "off");
    if (mode === "dryrun" || mode === "apply") {
        return mode;
    }
    return "off";
};

export const getResolveTimeoutMs = (): number => {
    return getEnvValue("KAIRO_EDITOR_RESOLVE_TIMEOUT_MS", 1500);
};

export const getMinLevenshteinTargetLen = (): number => {
    return getEnvValue("KAIRO_CHANGE_MIN_LEVENSHTEIN_TARGET_LEN", 20);
};

export const getMaxLevenshteinFileBytes = (): number => {
    return getEnvValue("KAIRO_CHANGE_MAX_LEVENSHTEIN_FILE_BYTES", 100000);
};

export const getAllowAmbiguousAutoPick = (): boolean => {
    const v2Enabled = getEditorV2Enabled();
    const v2Mode = getEditorV2Mode();
    if (v2Enabled && v2Mode !== "off") {
        return getEnvValue("KAIRO_EDITOR_ALLOW_AMBIGUOUS_AUTOPICK", false);
    }
    return getEnvValue("KAIRO_EDITOR_ALLOW_AMBIGUOUS_AUTOPICK", true);
};

export const getLayer3SmartMatchEnabled = (): boolean => {
    return getEnvValue("KAIRO_LAYER3_SMART_MATCH", false);
};

export const getLayer3SmartMatchThreshold = (): number => {
    return getEnvValue("KAIRO_LAYER3_SMART_MATCH_THRESHOLD", 0.85);
};

export const getLayer3SymbolImpactEnabled = (): boolean => {
    return getEnvValue("KAIRO_LAYER3_SYMBOL_IMPACT", false);
};

export const getLayer3ImpactMaxDepth = (): number => {
    return getEnvValue("KAIRO_LAYER3_IMPACT_MAX_DEPTH", 3);
};

export const getLayer3CodeGenEnabled = (): boolean => {
    return getEnvValue("KAIRO_LAYER3_CODE_GEN", false);
};

export const getLayer3GenSimilarCount = (): number => {
    return getEnvValue("KAIRO_LAYER3_GEN_SIMILAR_COUNT", 5);
};

export const getValidationConfig = (): ValidationConfig => {
    const defaults = getDefaultValidationConfig();
    if (getEnvValue("MCP_VALIDATION_DISABLED", false) === true) {
        return { ...defaults, syntax: "off", semantic: "off", lspDiagnostics: "off" };
    }

    const fileConfig = loadValidationConfig();
    const merged: ValidationConfig = { ...defaults, ...fileConfig };
    const baseSyntax = parseValidationMode(
        typeof merged.syntax === "string" ? merged.syntax : undefined,
        defaults.syntax
    );
    const baseSemantic = parseValidationMode(
        typeof merged.semantic === "string" ? merged.semantic : undefined,
        defaults.semantic
    );
    const baseLspDiagnostics = parseValidationMode(
        typeof merged.lspDiagnostics === "string" ? merged.lspDiagnostics : undefined,
        defaults.lspDiagnostics
    );
    const baseTimeout = parseValidationTimeout(
        typeof merged.timeoutMs === "string" ? merged.timeoutMs : undefined,
        typeof merged.timeoutMs === "number" ? merged.timeoutMs : defaults.timeoutMs
    );

    const syntax = parseValidationMode(
        process.env.MCP_VALIDATION_SYNTAX,
        baseSyntax
    );
    const semantic = parseValidationMode(
        process.env.MCP_VALIDATION_SEMANTIC,
        baseSemantic
    );
    const lspDiagnostics = parseValidationMode(
        process.env.MCP_VALIDATION_LSP,
        baseLspDiagnostics
    );
    const timeoutMs = parseValidationTimeout(
        process.env.MCP_VALIDATION_TIMEOUT,
        baseTimeout
    );

    return {
        syntax,
        semantic,
        lspDiagnostics,
        timeoutMs
    };
};

export const getArchitecturalSafetyConfig = (): {
    enabled: boolean;
    coreThreshold: number;
    blockPolicy: string;
    maxDepth: number;
} => {
    const fileConfig = loadArchitecturalSafetyConfig();
    return {
        enabled: getEnvValue("KAIRO_ARCH_SAFETY_ENABLED", fileConfig.enabled ?? true),
        coreThreshold: getEnvValue("KAIRO_CORE_THRESHOLD", fileConfig.coreThreshold ?? 0.3),
        blockPolicy: getEnvValue("KAIRO_ARCH_SAFETY_BLOCK_POLICY", fileConfig.blockPolicy ?? "warn_only"),
        maxDepth: getEnvValue("KAIRO_CYCLE_MAX_DEPTH", fileConfig.maxDepth ?? 8)
    };
};

export const getIntegrityGuardrailsConfig = (): {
    enabled: boolean;
    layerRules?: {
        layers: Array<{ name: string; match: string[] }>;
        allow?: Array<{ from: string; to: string }>;
        deny?: Array<{ from: string; to: string }>;
    };
    coreProtection: {
        pageRankThreshold: number;
        incomingCountThreshold: number;
        blockPolicy: string;
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
        mode: "strict" | "balanced" | "permissive";
        fallbackConfidence: "low" | "medium";
    };
    performance: {
        pageRankCacheTTL: number;
    };
} => {
    const fileConfig = loadIntegrityGuardrailsConfig();
    return {
        enabled: getEnvValue("KAIRO_GUARDRAILS_ENABLED", fileConfig.enabled ?? true),
        layerRules: fileConfig.layerRules,
        coreProtection: {
            pageRankThreshold: getEnvValue("KAIRO_CORE_PAGERANK_THRESHOLD", fileConfig.coreProtection?.pageRankThreshold ?? 0.3),
            incomingCountThreshold: getEnvValue("KAIRO_CORE_INCOMING_THRESHOLD", fileConfig.coreProtection?.incomingCountThreshold ?? 10),
            blockPolicy: getEnvValue("KAIRO_CORE_BLOCK_POLICY", fileConfig.coreProtection?.blockPolicy ?? "warn_only")
        },
        protocolProtection: {
            files: fileConfig.protocolProtection?.files ?? ["src/utils/StdoutGuard.ts", "src/server/**"],
            forbiddenTokens: fileConfig.protocolProtection?.forbiddenTokens ?? ["process.stdout", "process.stderr", "console.log"],
            allowlist: fileConfig.protocolProtection?.allowlist
        },
        publicSurfaceMonitor: {
            enabled: fileConfig.publicSurfaceMonitor?.enabled ?? true,
            impactThreshold: fileConfig.publicSurfaceMonitor?.impactThreshold ?? 10,
            requireBatchRefactoring: fileConfig.publicSurfaceMonitor?.requireBatchRefactoring ?? true
        },
        languageParity: {
            mode: fileConfig.languageParity?.mode ?? "balanced",
            fallbackConfidence: fileConfig.languageParity?.fallbackConfidence ?? "low"
        },
        performance: {
            pageRankCacheTTL: fileConfig.performance?.pageRankCacheTTL ?? 300000
        }
    };
};

export const getOverridePolicy = (): {
    enabled: boolean;
    maxTtlMinutes: number;
    maxFiles: number;
    allowed: Record<string, boolean | "confirm_only">;
} => {
    const isTestEnv = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
    const defaults = isTestEnv
        ? {
            enabled: true,
            maxTtlMinutes: 60,
            maxFiles: 50,
            allowed: {
                "editPolicy.allowDelete": "confirm_only" as const,
                "editPolicy.allowPartialApply": true,
                "staleGuard.bypass": true
            } as Record<string, boolean | "confirm_only">
        }
        : { enabled: false, maxTtlMinutes: 60, maxFiles: 50, allowed: {} };
    const fileConfig = loadOverridesConfig();
    return {
        enabled: fileConfig.enabled ?? defaults.enabled,
        maxTtlMinutes: Number.isFinite(fileConfig.maxTtlMinutes) ? (fileConfig.maxTtlMinutes as number) : defaults.maxTtlMinutes,
        maxFiles: Number.isFinite(fileConfig.maxFiles) ? (fileConfig.maxFiles as number) : defaults.maxFiles,
        allowed: fileConfig.allowed ?? defaults.allowed
    };
};

const loadValidationConfig = (): Partial<ValidationConfig> => {
    const configPath = resolveMcpConfigPath();
    if (!fs.existsSync(configPath)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed?.validation ?? {};
    } catch (error) {
        console.warn(`[ConfigurationManager] Failed to read ${path.basename(configPath)}:`, error);
        return {};
    }
};

const getDefaultValidationConfig = (): ValidationConfig => {
    return {
        syntax: "warn",
        semantic: "off",
        lspDiagnostics: "off",
        timeoutMs: 2000
    };
};

const loadArchitecturalSafetyConfig = (): {
    enabled?: boolean;
    coreThreshold?: number;
    blockPolicy?: string;
    maxDepth?: number;
} => {
    const configPath = resolveMcpConfigPath();
    if (!fs.existsSync(configPath)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed?.architecturalSafety ?? {};
    } catch (error) {
        console.warn(`[ConfigurationManager] Failed to read ${path.basename(configPath)}:`, error);
        return {};
    }
};

const loadIntegrityGuardrailsConfig = (): {
    enabled?: boolean;
    layerRules?: {
        layers: Array<{ name: string; match: string[] }>;
        allow?: Array<{ from: string; to: string }>;
        deny?: Array<{ from: string; to: string }>;
    };
    coreProtection?: {
        pageRankThreshold?: number;
        incomingCountThreshold?: number;
        blockPolicy?: string;
    };
    protocolProtection?: {
        files?: string[];
        forbiddenTokens?: string[];
        allowlist?: Array<{ file: string; tokens: string[]; reason: string }>;
    };
    publicSurfaceMonitor?: {
        enabled?: boolean;
        impactThreshold?: number;
        requireBatchRefactoring?: boolean;
    };
    languageParity?: {
        mode?: "strict" | "balanced" | "permissive";
        fallbackConfidence?: "low" | "medium";
    };
    performance?: {
        pageRankCacheTTL?: number;
    };
} => {
    const configPath = resolveMcpConfigPath();
    if (!fs.existsSync(configPath)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed?.integrityGuardrails ?? {};
    } catch (error) {
        console.warn(`[ConfigurationManager] Failed to read ${path.basename(configPath)}:`, error);
        return {};
    }
};

const loadOverridesConfig = (): OverridePolicyConfig => {
    const configPath = resolveMcpConfigPath();
    if (!fs.existsSync(configPath)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed?.overrides ?? {};
    } catch (error) {
        console.warn(`[ConfigurationManager] Failed to read ${path.basename(configPath)}:`, error);
        return {};
    }
};

const parseValidationMode = (value: string | undefined, fallback: ValidationMode): ValidationMode => {
    if (value === "off" || value === "warn" || value === "error") {
        return value;
    }
    return fallback;
};

const resolveMcpConfigPath = (): string => {
    const configDir = PathManager.getConfigDir();
    const primary = path.join(configDir, ".mcp-config.json");
    if (fs.existsSync(primary)) return primary;

    const legacyConfigDir = path.join(configDir, "mcp-config.json");
    if (fs.existsSync(legacyConfigDir)) return legacyConfigDir;

    const legacyRoot = path.join(process.cwd(), ".mcp-config.json");
    if (fs.existsSync(legacyRoot)) return legacyRoot;

    return primary;
};

const parseValidationTimeout = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
};
