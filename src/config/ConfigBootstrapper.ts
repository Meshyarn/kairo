import path from "path";
import { LanguageConfigLoader } from "./LanguageConfig.js";
import { PathManager } from "../utils/PathManager.js";
import { buildIgnoreFilter, scanLanguages, detectRepositories } from "./ConfigBootstrapperScan.js";
import { detectWasm, detectQueryGaps, buildQueryGapFindings, buildWasmFindings, buildParityFindings } from "./ConfigBootstrapperDetection.js";
import {
    buildMcpConfigPlan,
    buildLanguagesConfigPlan,
    buildGraphRagConfigPlan,
    buildMcpPolicyConfig,
    buildVscodePlan,
    buildMissingPatch,
    normalizeLegacyMultiRepo
} from "./ConfigBootstrapperPlans.js";
import { buildContractFindings, buildContractPlan } from "./ConfigBootstrapperContracts.js";
import { applyPlan, readJsonFile } from "./ConfigBootstrapperIO.js";
import {
    resolveMode,
    resolveTargets,
    resolvePreset,
    resolveScanOptions,
    resolveRootPath,
    resolveStatus,
    buildSummary,
    applyScope,
    slugify,
    titleCase
} from "./ConfigBootstrapperUtils.js";
import type {
    ConfigWriteOp,
    ConfigFinding,
    BootstrapApplyResult,
    ManageInitArgs,
    ManageDoctorArgs,
    ManageBootstrapResult
} from "./ConfigBootstrapperTypes.js";


export class ConfigBootstrapper {
    private readonly rootPath: string;

    constructor(rootPath: string) {
        this.rootPath = path.resolve(rootPath);
    }

    async init(args: ManageInitArgs = {}): Promise<ManageBootstrapResult> {
        return this.run("init", args);
    }

    async doctor(args: ManageDoctorArgs = {}): Promise<ManageBootstrapResult> {
        return this.run("doctor", args);
    }

    private async run(
        operation: "init" | "doctor",
        args: ManageInitArgs | ManageDoctorArgs
    ): Promise<ManageBootstrapResult> {
        const mode = resolveMode(args);
        const targets = resolveTargets(args);
        const rootPath = resolveRootPath(this.rootPath, (args as ManageInitArgs).root);
        const configDir = PathManager.resolveForRoot(rootPath, "config");
        const mcpPolicyPath = path.join(configDir, "mcp.json");
        const mcpConfigPath = path.join(configDir, ".mcp-config.json");
        const legacyConfigDirMcpPath = path.join(configDir, "mcp-config.json");
        const legacyRootMcpPath = path.join(rootPath, ".mcp-config.json");
        const languagesConfigPath = path.join(configDir, "languages.json");
        const graphragConfigPath = path.join(configDir, "graphrag.json");
        const vscodeConfigPath = path.join(rootPath, ".vscode", "mcp.json");

        const scanOptions = resolveScanOptions(args);
        const ignoreFilter = buildIgnoreFilter(rootPath);
        const languageConfig = new LanguageConfigLoader(rootPath);

        const globalScan = scanLanguages(rootPath, rootPath, ignoreFilter, languageConfig, scanOptions);
        const repos = detectRepositories({
            rootPath,
            ignoreFilter,
            languageConfig,
            options: scanOptions,
            multiRepoMode: (args as ManageInitArgs).multiRepo ?? "auto",
            globalScan,
            slugify: (value) => slugify(value),
            titleCase: (value) => titleCase(value)
        });
        const languages = globalScan.languages;

        const wasm = detectWasm(languages.map((lang) => lang.languageId), rootPath);
        const queryGaps = detectQueryGaps(languages.map((lang) => lang.languageId));

        const findings: ConfigFinding[] = [];
        const hints: string[] = [];

        if (globalScan.truncated) {
            findings.push({
                code: "SCAN_TRUNCATED",
                severity: "warn",
                message: `Language scan hit maxFiles=${scanOptions.maxFiles}; results are sample-based.`,
                action: "rerun_with_higher_limit",
                evidence: { maxFiles: scanOptions.maxFiles }
            });
        }

        if (globalScan.unknownExtensions.length > 0) {
            findings.push({
                code: "LANGUAGE_GAP",
                severity: "warn",
                message: "Found file extensions without language mappings.",
                action: "add_language_mappings",
                evidence: { extensions: globalScan.unknownExtensions }
            });
            hints.push(`Unknown extensions detected: ${globalScan.unknownExtensions.join(", ")}. Consider adding mappings in ${languagesConfigPath}.`);
        }

        const mcpPolicyConfig = readJsonFile(mcpPolicyPath);
        if (mcpPolicyConfig.error) {
            findings.push({
                code: "CONFIG_PARSE_ERROR",
                severity: "error",
                message: `Failed to parse ${path.basename(mcpPolicyPath)}.`,
                action: "fix_json",
                evidence: { path: mcpPolicyPath }
            });
        }

        const mcpConfig = readJsonFile(mcpConfigPath);
        if (mcpConfig.error) {
            findings.push({
                code: "CONFIG_PARSE_ERROR",
                severity: "error",
                message: `Failed to parse ${path.basename(mcpConfigPath)}.`,
                action: "fix_json",
                evidence: { path: mcpConfigPath }
            });
        }

        const legacyConfigDir = readJsonFile(legacyConfigDirMcpPath);
        if (legacyConfigDir.error) {
            findings.push({
                code: "CONFIG_PARSE_ERROR",
                severity: "error",
                message: `Failed to parse ${path.basename(legacyConfigDirMcpPath)}.`,
                action: "fix_json",
                evidence: { path: legacyConfigDirMcpPath }
            });
        }

        const legacyRootConfig = readJsonFile(legacyRootMcpPath);
        if (legacyRootConfig.error) {
            findings.push({
                code: "CONFIG_PARSE_ERROR",
                severity: "error",
                message: `Failed to parse ${path.basename(legacyRootMcpPath)}.`,
                action: "fix_json",
                evidence: { path: legacyRootMcpPath }
            });
        }

        const graphragConfig = readJsonFile(graphragConfigPath);
        if (graphragConfig.error) {
            findings.push({
                code: "CONFIG_PARSE_ERROR",
                severity: "error",
                message: `Failed to parse ${path.basename(graphragConfigPath)}.`,
                action: "fix_json",
                evidence: { path: graphragConfigPath }
            });
        }

        const legacyMultiRepo = legacyRootConfig.value?.multiRepo;
        const legacyLanguages = legacyRootConfig.value?.languages;
        const legacyPolicyConfig = buildMcpPolicyConfig(legacyRootConfig.value);
        const repoSeedConfig = mcpConfig.value
            ? undefined
            : ((legacyConfigDir.value && typeof legacyConfigDir.value === "object" && !Array.isArray(legacyConfigDir.value))
                ? legacyConfigDir.value
                : (legacyMultiRepo ? normalizeLegacyMultiRepo(legacyMultiRepo) : undefined));
        if (legacyConfigDir.value) {
            findings.push({
                code: "MIGRATION_NEEDED",
                severity: "warn",
                message: "Found legacy config at <KAIRO_DIR>/config/mcp-config.json; canonical config should live in <KAIRO_DIR>/config/.mcp-config.json.",
                action: "migrate_config",
                evidence: { path: legacyConfigDirMcpPath }
            });
        }
        if (legacyMultiRepo) {
            findings.push({
                code: "MIGRATION_NEEDED",
                severity: "warn",
                message: "Found multiRepo in legacy .mcp-config.json; canonical config should live in <KAIRO_DIR>/config/.mcp-config.json.",
                action: "migrate_config",
                evidence: { path: legacyRootMcpPath, key: "multiRepo" }
            });
        }
        if (legacyLanguages) {
            findings.push({
                code: "MIGRATION_NEEDED",
                severity: "warn",
                message: "Found languages in .mcp-config.json; canonical config should live in <KAIRO_DIR>/config/languages.json.",
                action: "migrate_config",
                evidence: { path: legacyRootMcpPath, key: "languages" }
            });
        }

        const queryGapFindings = buildQueryGapFindings(queryGaps);
        findings.push(...queryGapFindings);

        const wasmFindings = buildWasmFindings(wasm, languages);
        findings.push(...wasmFindings);

        const paritySignals = buildParityFindings(rootPath);
        findings.push(...paritySignals.findings);
        hints.push(...paritySignals.hints);

        if (wasm.missing.length > 0) {
            hints.push(`Missing WASM assets for: ${wasm.missing.join(", ")}. Consider setting KAIRO_WASM_DIR=${wasm.suggestedWasmDir ?? path.join(rootPath, "wasm")}`);
        }

        const contractSignals = buildContractFindings(rootPath, repos);
        findings.push(...contractSignals.findings);
        hints.push(...contractSignals.hints);

        const plan: ConfigWriteOp[] = [];
        if (targets.includes("kairo")) {
            const hostPreset = resolvePreset(args);
            const mcpPolicyBaseConfig = hostPreset === "minimal"
                ? {
                    version: 1,
                    mode: "mcp",
                    preset: "mcp-lean"
                }
                : {
                    version: 1,
                    mode: "mcp",
                    preset: "mcp-lean",
                    publicSurface: "compact",
                    applyHandshake: {
                        required: true,
                        tokenTtlMs: 30 * 60 * 1000,
                        oneTime: true,
                        invalidateOnDrift: true
                    },
                    autopilot: {
                        autoModeNeverApplies: true,
                        defaultOutputFormat: "summary",
                        maxAutoRepairAttempts: 1,
                        allowAutoReindex: false
                    }
                };
            let mcpPolicyPlan: ConfigWriteOp;
            if (mcpPolicyConfig.error) {
                mcpPolicyPlan = {
                    op: "noop",
                    path: mcpPolicyPath,
                    reason: "Fix JSON parse error before bootstrapping MCP mode config."
                };
            } else if (mcpPolicyConfig.value) {
                const patch = buildMissingPatch(mcpPolicyConfig.value, mcpPolicyBaseConfig);
                if (!patch) {
                    mcpPolicyPlan = { op: "noop", path: mcpPolicyPath, reason: "MCP mode config already present." };
                } else {
                    mcpPolicyPlan = {
                        op: "update",
                        path: mcpPolicyPath,
                        patch: {
                            beforeHash: mcpPolicyConfig.hash,
                            jsonMerge: patch
                        },
                        reason: "Backfill MCP mode config defaults."
                    };
                }
            } else {
                mcpPolicyPlan = {
                    op: "create",
                    path: mcpPolicyPath,
                    content: JSON.stringify(mcpPolicyBaseConfig, null, 2)
                };
            }
            plan.push(mcpPolicyPlan);

            const repoPlan = buildMcpConfigPlan(
                mcpConfigPath,
                repos,
                repoSeedConfig,
                legacyPolicyConfig,
                findings
            );
            plan.push(repoPlan);

            const languagesPlan = buildLanguagesConfigPlan(
                languagesConfigPath,
                legacyLanguages
            );
            if (languagesPlan) {
                plan.push(languagesPlan);
            }

            const graphragPlan = buildGraphRagConfigPlan(graphragConfigPath);
            if (graphragPlan) {
                plan.push(graphragPlan);
            }

            const applyOptions = (args as ManageInitArgs).applyOptions ?? {};
            if (applyOptions.legacyMcpConfig && legacyRootConfig.value && (legacyMultiRepo || legacyLanguages)) {
                const removeKeys = [
                    legacyMultiRepo ? "multiRepo" : undefined,
                    legacyLanguages ? "languages" : undefined
                ].filter(Boolean) as string[];
                if (removeKeys.length > 0) {
                    plan.push({
                        op: "update",
                        path: legacyRootMcpPath,
                        patch: {
                            beforeHash: legacyRootConfig.hash,
                            removeKeys
                        },
                        reason: "Remove legacy multiRepo/languages after migration."
                    });
                }
            }

            plan.push(...buildContractPlan(rootPath, repos));
        }

        if (targets.includes("vscode")) {
            const preset = resolvePreset(args);
            const vscodePlan = buildVscodePlan(vscodeConfigPath, preset, rootPath);
            if (vscodePlan) {
                plan.push(vscodePlan);
            }
        }

        const scoped = applyScope(
            (args as ManageDoctorArgs).scope,
            { findings, plan, hints }
        );
        findings.splice(0, findings.length, ...scoped.findings);
        plan.splice(0, plan.length, ...scoped.plan);
        hints.splice(0, hints.length, ...scoped.hints);

        const status = resolveStatus(findings);
        const summary = buildSummary(operation, plan, findings, mode);

        let applied: BootstrapApplyResult[] | undefined;
        let success = true;
        if (mode === "apply") {
            applied = await applyPlan(plan, (args as ManageInitArgs).applyOptions);
            success = applied.every((entry) => entry.success);
        }

        return {
            success,
            status,
            summary,
            detected: {
                root: rootPath,
                repos,
                languages,
                wasm
            },
            findings,
            plan,
            hints,
            applied
        };
    }

}
