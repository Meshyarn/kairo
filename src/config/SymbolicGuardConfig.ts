import fs from "fs";
import { PathManager } from "../utils/PathManager.js";

export type SymbolicGuardMode = "off" | "warn" | "block_high" | "strict";
export type SymbolicGuardRuleSeverity = "warn" | "high";

export type SymbolicGuardRuleConfig = {
    enabled: boolean;
    severity: SymbolicGuardRuleSeverity;
};

export type SymbolicGuardContractGuardConfig = {
    mode: "spec_only" | "spec_plus_consumer_scan";
    consumerScan: { enabled: boolean; maxFiles: number };
};

export type SymbolicGuardSolverConfig = {
    enabled: boolean;
    providerOrder: string[];
    timeSliceMs: number;
};

export type SymbolicGuardConfig = {
    version: number;
    enabled: boolean;
    mode: SymbolicGuardMode;
    timeoutMs: number;
    maxDiagnostics: number;
    maxPaths: number;
    maxConstraints: number;
    rules: Record<string, SymbolicGuardRuleConfig>;
    contractGuard: SymbolicGuardContractGuardConfig;
    solver: SymbolicGuardSolverConfig;
};

export const DEFAULT_SYMBOLIC_GUARD_CONFIG: SymbolicGuardConfig = {
    version: 1,
    enabled: false,
    mode: "warn",
    timeoutMs: 1200,
    maxDiagnostics: 12,
    maxPaths: 64,
    maxConstraints: 400,
    rules: {
        index_bounds: { enabled: true, severity: "high" },
        division_by_zero: { enabled: true, severity: "high" },
        null_deref_without_guard: { enabled: true, severity: "warn" },
        regex_unanchored: { enabled: false, severity: "warn" }
    },
    contractGuard: {
        mode: "spec_only",
        consumerScan: { enabled: false, maxFiles: 200 }
    },
    solver: {
        enabled: false,
        providerOrder: ["rust"],
        timeSliceMs: 200
    }
};

const parseBooleanEnv = (raw: string | undefined): boolean | undefined => {
    if (!raw) return undefined;
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "on", "yes"].includes(normalized)) return true;
    if (["false", "0", "off", "no"].includes(normalized)) return false;
    return undefined;
};

const parseNumberEnv = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
};

const resolveConfigPath = (rootPath: string): string => {
    const primary = PathManager.resolveForRoot(rootPath, "config", "symbolic-guards.json");
    if (fs.existsSync(primary)) return primary;
    const legacy = PathManager.resolveForRoot(rootPath, "symbolic-guards.json");
    if (fs.existsSync(legacy)) return legacy;
    return primary;
};

const mergeConfig = (base: SymbolicGuardConfig, override?: Partial<SymbolicGuardConfig>): SymbolicGuardConfig => {
    if (!override) return base;
    return {
        ...base,
        ...override,
        rules: { ...base.rules, ...(override.rules ?? {}) },
        contractGuard: {
            ...base.contractGuard,
            ...(override.contractGuard ?? {}),
            consumerScan: {
                ...base.contractGuard.consumerScan,
                ...(override.contractGuard?.consumerScan ?? {})
            }
        },
        solver: {
            ...base.solver,
            ...(override.solver ?? {})
        }
    };
};

export const resolveSymbolicGuardConfig = (rootPath: string = process.cwd()): SymbolicGuardConfig => {
    const configPath = resolveConfigPath(rootPath);
    let userConfig: Partial<SymbolicGuardConfig> | undefined;
    try {
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, "utf-8");
            userConfig = JSON.parse(raw);
        }
    } catch (error) {
        console.warn(`[SymbolicGuardConfig] Failed to parse ${configPath}:`, error);
    }

    let merged = mergeConfig(DEFAULT_SYMBOLIC_GUARD_CONFIG, userConfig);

    const enabledOverride = parseBooleanEnv(process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED);
    if (typeof enabledOverride === "boolean") {
        merged = { ...merged, enabled: enabledOverride };
    }
    const modeOverride = process.env.KAIRO_SYMBOLIC_GUARDS_MODE;
    if (modeOverride === "off" || modeOverride === "warn" || modeOverride === "block_high" || modeOverride === "strict") {
        merged = { ...merged, mode: modeOverride };
    }

    merged = {
        ...merged,
        timeoutMs: parseNumberEnv(process.env.KAIRO_SYMBOLIC_GUARDS_TIMEOUT_MS, merged.timeoutMs),
        maxDiagnostics: parseNumberEnv(process.env.KAIRO_SYMBOLIC_GUARDS_MAX_DIAGNOSTICS, merged.maxDiagnostics),
        maxPaths: parseNumberEnv(process.env.KAIRO_SYMBOLIC_GUARDS_MAX_PATHS, merged.maxPaths),
        maxConstraints: parseNumberEnv(process.env.KAIRO_SYMBOLIC_GUARDS_MAX_CONSTRAINTS, merged.maxConstraints)
    };

    return merged;
};
