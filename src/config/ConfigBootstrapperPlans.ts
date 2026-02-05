import path from "path";
import { DEFAULT_GRAPHRAG_CONFIG } from "./GraphRagConfig.js";
import { readJsonFile, deepMerge } from "./ConfigBootstrapperIO.js";
import type { ConfigFinding, ConfigWriteOp, HostPreset, RepoSummary } from "./ConfigBootstrapperTypes.js";

export const buildMcpConfigPlan = (
    configPath: string,
    repos: RepoSummary[],
    repoSeedConfig: any,
    policyConfig: Record<string, unknown>,
    findings: ConfigFinding[]
): ConfigWriteOp => {
    const existing = readJsonFile(configPath);
    const baseConfig = existing.value
        ? buildRepoConfig(repos)
        : (repoSeedConfig ?? buildRepoConfig(repos));
    if (existing.value) {
        const conflict = detectRepoConflicts(existing.value, baseConfig);
        if (conflict) {
            findings.push(conflict);
            return { op: "noop", path: configPath, reason: "Repository config conflict detected." };
        }
        const repoPatch = buildMissingPatch(existing.value, baseConfig);
        const policyPatch = buildMissingPatch(existing.value, policyConfig);
        const mergedPatch = deepMerge(repoPatch ?? {}, policyPatch ?? {});
        if (!mergedPatch || Object.keys(mergedPatch).length === 0) {
            return { op: "noop", path: configPath, reason: "MCP config already present." };
        }
        return {
            op: "update",
            path: configPath,
            patch: {
                beforeHash: existing.hash,
                jsonMerge: mergedPatch
            },
            reason: "Merge detected repositories and policy defaults into config."
        };
    }
    const policyPatch = buildMissingPatch(baseConfig, policyConfig);
    const combined = policyPatch ? deepMerge(baseConfig, policyPatch) : baseConfig;
    return {
        op: "create",
        path: configPath,
        content: JSON.stringify(combined, null, 2)
    };
};

export const detectRepoConflicts = (existing: any, desired: any): ConfigFinding | null => {
    const existingRepos = existing?.repositories;
    const desiredRepos = desired?.repositories;
    if (!existingRepos || !desiredRepos) return null;
    for (const [id, repo] of Object.entries(desiredRepos)) {
        const existingRepo = (existingRepos as any)[id];
        if (!existingRepo) continue;
        if (existingRepo.path && existingRepo.path !== (repo as any).path) {
            return {
                code: "CONFIG_CONFLICT",
                severity: "error",
                message: `Repository id '${id}' has a different path in existing config.`,
                action: "resolve_conflict",
                evidence: { id, existingPath: existingRepo.path, desiredPath: (repo as any).path }
            };
        }
    }
    return null;
};

export const buildRepoConfig = (repos: RepoSummary[]) => {
    const repositories: Record<string, any> = {};
    for (const repo of repos) {
        repositories[repo.id] = {
            path: repo.path,
            name: repo.name,
            type: repo.type,
            languages: repo.languages,
            allowCrossRepoEdits: repo.allowCrossRepoEdits ?? false,
            excludePatterns: repo.excludePatterns
        };
    }
    return {
        version: "1.0",
        defaultRepo: repos[0]?.id ?? "main",
        repositories
    };
};

export const normalizeLegacyMultiRepo = (legacy: any) => {
    const repositories = legacy?.repositories ?? {};
    const defaultRepo = legacy?.defaultRepo ?? Object.keys(repositories)[0] ?? "main";
    return {
        version: legacy?.version ?? "1.0",
        defaultRepo,
        repositories
    };
};

export const buildLanguagesConfigPlan = (configPath: string, legacyLanguages: any): ConfigWriteOp | null => {
    if (!legacyLanguages) {
        return null;
    }
    const existing = readJsonFile(configPath);
    if (existing.value) {
        const patch = buildMissingPatch(existing.value, legacyLanguages);
        if (!patch) {
            return { op: "noop", path: configPath, reason: "Languages config already present." };
        }
        return {
            op: "update",
            path: configPath,
            patch: {
                beforeHash: existing.hash,
                jsonMerge: patch
            },
            reason: "Merge legacy language mappings into canonical config."
        };
    }
    return {
        op: "create",
        path: configPath,
        content: JSON.stringify(legacyLanguages, null, 2)
    };
};

export const buildGraphRagConfigPlan = (configPath: string): ConfigWriteOp | null => {
    const existing = readJsonFile(configPath);
    if (existing.value) {
        const patch = buildMissingPatch(existing.value, DEFAULT_GRAPHRAG_CONFIG);
        if (!patch) {
            return { op: "noop", path: configPath, reason: "GraphRAG config already present." };
        }
        return {
            op: "update",
            path: configPath,
            patch: {
                beforeHash: existing.hash,
                jsonMerge: patch
            },
            reason: "Backfill GraphRAG defaults."
        };
    }
    return {
        op: "create",
        path: configPath,
        content: JSON.stringify(DEFAULT_GRAPHRAG_CONFIG, null, 2)
    };
};

export const buildMcpPolicyConfig = (legacyConfig?: any): Record<string, unknown> => {
    const baseConfig = {
        validation: { syntax: "warn", semantic: "off", lspDiagnostics: "off", timeoutMs: 2000 },
        integrityGuardrails: { enabled: true },
        architecturalSafety: { enabled: true }
    };
    if (!legacyConfig || typeof legacyConfig !== "object") {
        return baseConfig;
    }
    const config = { ...baseConfig } as Record<string, unknown>;
    if (legacyConfig.validation) {
        config.validation = legacyConfig.validation;
    }
    if (legacyConfig.integrityGuardrails) {
        config.integrityGuardrails = legacyConfig.integrityGuardrails;
    }
    if (legacyConfig.architecturalSafety) {
        config.architecturalSafety = legacyConfig.architecturalSafety;
    }
    if (legacyConfig.overrides) {
        config.overrides = legacyConfig.overrides;
    }
    return config;
};

export const buildVscodePlan = (configPath: string, preset: HostPreset, rootPath: string): ConfigWriteOp | null => {
    const env = buildVscodeEnv(preset, rootPath);
    const baseConfig = {
        inputs: [],
        servers: {
            kairo: {
                type: "stdio",
                command: "node",
                cwd: "${workspaceFolder}",
                args: ["--max-old-space-size=8196", "${workspaceFolder}/dist/index.js"],
                env
            }
        }
    };

    const existing = readJsonFile(configPath);
    if (existing.value) {
        const patch = buildMissingPatch(existing.value, baseConfig);
        if (!patch) {
            return { op: "noop", path: configPath, reason: "VSCode MCP config already present." };
        }
        return {
            op: "update",
            path: configPath,
            patch: {
                beforeHash: existing.hash,
                jsonMerge: patch
            },
            reason: "Patch VSCode MCP config with suggested defaults."
        };
    }

    return {
        op: "create",
        path: configPath,
        content: JSON.stringify(baseConfig, null, 2)
    };
};

export const buildVscodeEnv = (preset: HostPreset, rootPath: string): Record<string, string> => {
    const env: Record<string, string> = {
        KAIRO_LOG_TO_FILE: "true",
        KAIRO_ALLOW_STDOUT_LOGS: "false"
    };

    const wasmDir = path.join(rootPath, "wasm");
    env.KAIRO_WASM_DIR = wasmDir;

    if (preset === "recommended") {
        env.KAIRO_LOG_LEVEL = "info";
        env.KAIRO_VECTOR_INDEX_REBUILD = "auto";
    }

    return env;
};

export const buildMissingPatch = (existing: any, desired: any): Record<string, unknown> | null => {
    const patch = mergeMissing(existing, desired);
    if (!patch || Object.keys(patch).length === 0) {
        return null;
    }
    return patch as Record<string, unknown>;
};

export const mergeMissing = (existing: any, desired: any): any => {
    if (existing === undefined || existing === null) {
        return desired;
    }
    if (typeof existing !== "object" || typeof desired !== "object") {
        return undefined;
    }
    if (Array.isArray(existing) || Array.isArray(desired)) {
        return undefined;
    }
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(desired)) {
        if (!(key in existing)) {
            patch[key] = value as unknown;
            continue;
        }
        const nested = mergeMissing((existing as any)[key], value);
        if (nested && typeof nested === "object" && Object.keys(nested).length > 0) {
            patch[key] = nested;
        }
    }
    return patch;
};
