import fs from "fs";
import path from "path";
import * as crypto from "crypto";
import ignore from "ignore";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { LanguageConfigLoader, BUILTIN_LANGUAGE_MAPPINGS } from "./LanguageConfig.js";
import { DEFAULT_GRAPHRAG_CONFIG } from "./GraphRagConfig.js";
import { getSupportForLanguageId, SupportLevel } from "./LanguageSupportLevels.js";
import { LANGUAGE_PARITY_MATRIX, resolveRequiredQueries } from "./LanguageParityMatrix.js";
import { ContractManifestLoader } from "../contracts/ContractManifestLoader.js";
import { ContractManifestGenerator } from "../contracts/ContractManifestGenerator.js";

export type BootstrapMode = "plan" | "apply";
export type BootstrapTarget = "kairo" | "vscode";
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

const DEFAULT_IGNORE_DIRS = [".git", "node_modules", ".mcp", ".kairo", ".kairo-index", "dist", "coverage"];
const DEFAULT_EXCLUDE_PATTERNS = ["dist/**", "coverage/**"];
const DEFAULT_MAX_FILES = 20000;

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
        const mode = this.resolveMode(args);
        const targets = this.resolveTargets(args);
        const rootPath = this.resolveRootPath((args as ManageInitArgs).root);
        const baseDir = resolveBaseDir();
        const configDir = path.join(rootPath, baseDir, "config");
        const mcpPolicyPath = path.join(configDir, "mcp.json");
        const mcpConfigPath = path.join(configDir, ".mcp-config.json");
        const legacyConfigDirMcpPath = path.join(configDir, "mcp-config.json");
        const legacyRootMcpPath = path.join(rootPath, ".mcp-config.json");
        const languagesConfigPath = path.join(configDir, "languages.json");
        const graphragConfigPath = path.join(configDir, "graphrag.json");
        const vscodeConfigPath = path.join(rootPath, ".vscode", "mcp.json");

        const scanOptions = this.resolveScanOptions(args);
        const ignoreFilter = this.buildIgnoreFilter(rootPath);
        const languageConfig = new LanguageConfigLoader(rootPath);

        const globalScan = this.scanLanguages(rootPath, rootPath, ignoreFilter, languageConfig, scanOptions);
        const repos = this.detectRepositories(
            rootPath,
            ignoreFilter,
            languageConfig,
            scanOptions,
            (args as ManageInitArgs).multiRepo ?? "auto",
            globalScan
        );
        const languages = globalScan.languages;

        const wasm = this.detectWasm(languages.map((lang) => lang.languageId), rootPath);
        const queryGaps = this.detectQueryGaps(languages.map((lang) => lang.languageId));

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

        const mcpPolicyConfig = this.readJsonFile(mcpPolicyPath);
        if (mcpPolicyConfig.error) {
            findings.push({
                code: "CONFIG_PARSE_ERROR",
                severity: "error",
                message: `Failed to parse ${path.basename(mcpPolicyPath)}.`,
                action: "fix_json",
                evidence: { path: mcpPolicyPath }
            });
        }

        const mcpConfig = this.readJsonFile(mcpConfigPath);
        if (mcpConfig.error) {
            findings.push({
                code: "CONFIG_PARSE_ERROR",
                severity: "error",
                message: `Failed to parse ${path.basename(mcpConfigPath)}.`,
                action: "fix_json",
                evidence: { path: mcpConfigPath }
            });
        }

        const legacyConfigDir = this.readJsonFile(legacyConfigDirMcpPath);
        if (legacyConfigDir.error) {
            findings.push({
                code: "CONFIG_PARSE_ERROR",
                severity: "error",
                message: `Failed to parse ${path.basename(legacyConfigDirMcpPath)}.`,
                action: "fix_json",
                evidence: { path: legacyConfigDirMcpPath }
            });
        }

        const legacyRootConfig = this.readJsonFile(legacyRootMcpPath);
        if (legacyRootConfig.error) {
            findings.push({
                code: "CONFIG_PARSE_ERROR",
                severity: "error",
                message: `Failed to parse ${path.basename(legacyRootMcpPath)}.`,
                action: "fix_json",
                evidence: { path: legacyRootMcpPath }
            });
        }

        const graphragConfig = this.readJsonFile(graphragConfigPath);
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
        const legacyPolicyConfig = this.buildMcpPolicyConfig(legacyRootConfig.value);
        const repoSeedConfig = mcpConfig.value
            ? undefined
            : ((legacyConfigDir.value && typeof legacyConfigDir.value === "object" && !Array.isArray(legacyConfigDir.value))
                ? legacyConfigDir.value
                : (legacyMultiRepo ? this.normalizeLegacyMultiRepo(legacyMultiRepo) : undefined));
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

        const queryGapFindings = this.buildQueryGapFindings(queryGaps);
        findings.push(...queryGapFindings);

        const wasmFindings = this.buildWasmFindings(wasm, languages);
        findings.push(...wasmFindings);

        const paritySignals = this.buildParityFindings(rootPath);
        findings.push(...paritySignals.findings);
        hints.push(...paritySignals.hints);

        if (wasm.missing.length > 0) {
            hints.push(`Missing WASM assets for: ${wasm.missing.join(", ")}. Consider setting KAIRO_WASM_DIR=${wasm.suggestedWasmDir ?? path.join(rootPath, "wasm")}`);
        }

        const contractSignals = this.buildContractFindings(rootPath, repos);
        findings.push(...contractSignals.findings);
        hints.push(...contractSignals.hints);

        const plan: ConfigWriteOp[] = [];
        if (targets.includes("kairo")) {
            const hostPreset = this.resolvePreset(args);
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
                const patch = this.buildMissingPatch(mcpPolicyConfig.value, mcpPolicyBaseConfig);
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

            const repoPlan = this.buildMcpConfigPlan(
                mcpConfigPath,
                repos,
                repoSeedConfig,
                legacyPolicyConfig,
                findings
            );
            plan.push(repoPlan);

            const languagesPlan = this.buildLanguagesConfigPlan(
                languagesConfigPath,
                legacyLanguages
            );
            if (languagesPlan) {
                plan.push(languagesPlan);
            }

            const graphragPlan = this.buildGraphRagConfigPlan(graphragConfigPath);
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

            plan.push(...this.buildContractPlan(rootPath, repos));
        }

        if (targets.includes("vscode")) {
            const preset = this.resolvePreset(args);
            const vscodePlan = this.buildVscodePlan(vscodeConfigPath, preset, rootPath);
            if (vscodePlan) {
                plan.push(vscodePlan);
            }
        }

        const scoped = this.applyScope(
            (args as ManageDoctorArgs).scope,
            { findings, plan, hints }
        );
        findings.splice(0, findings.length, ...scoped.findings);
        plan.splice(0, plan.length, ...scoped.plan);
        hints.splice(0, hints.length, ...scoped.hints);

        const status = this.resolveStatus(findings);
        const summary = this.buildSummary(operation, plan, findings, mode);

        let applied: BootstrapApplyResult[] | undefined;
        let success = true;
        if (mode === "apply") {
            applied = await this.applyPlan(plan, (args as ManageInitArgs).applyOptions);
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

    private resolveMode(args: ManageInitArgs | ManageDoctorArgs): BootstrapMode {
        if ((args as ManageInitArgs).mode === "apply") return "apply";
        if ((args as any).apply === true) return "apply";
        return "plan";
    }

    private resolveTargets(args: ManageInitArgs | ManageDoctorArgs): BootstrapTarget[] {
        const targets = (args as ManageInitArgs).targets;
        if (!Array.isArray(targets) || targets.length === 0) {
            return ["kairo"];
        }
        return targets.filter((target) => target === "kairo" || target === "vscode");
    }

    private resolvePreset(args: ManageInitArgs | ManageDoctorArgs): HostPreset {
        const preset = (args as ManageInitArgs).presets;
        return preset === "minimal" ? "minimal" : "recommended";
    }

    private resolveScanOptions(args: ManageInitArgs | ManageDoctorArgs): {
        maxFiles: number;
        includeDocs: boolean;
        sampleBytesPerFile: number;
    } {
        const scan = (args as ManageInitArgs).languageScan ?? {};
        return {
            maxFiles: typeof scan.maxFiles === "number" ? scan.maxFiles : DEFAULT_MAX_FILES,
            includeDocs: scan.includeDocs !== false,
            sampleBytesPerFile: typeof scan.sampleBytesPerFile === "number" ? scan.sampleBytesPerFile : 0
        };
    }

    private resolveRootPath(input?: string): string {
        const fromEnv = process.env.KAIRO_ROOT_PATH ?? process.env.KAIRO_ROOT;
        const base = input || fromEnv || this.rootPath;
        if (path.isAbsolute(base)) {
            return path.resolve(base);
        }
        return path.resolve(this.rootPath, base);
    }

    private buildIgnoreFilter(rootPath: string) {
        const ig = (ignore as unknown as () => any)();
        const patterns = this.loadIgnorePatterns(rootPath);
        const defaults = DEFAULT_IGNORE_DIRS.map((dir) => `${dir}/**`);
        ig.add([...defaults, ...patterns]);
        return ig;
    }

    private loadIgnorePatterns(rootPath: string): string[] {
        const ignoreFiles = this.collectIgnoreFiles(rootPath);
        const patterns: string[] = [];
        for (const absPath of ignoreFiles) {
            try {
                const content = fs.readFileSync(absPath, "utf-8");
                const relDir = path.relative(rootPath, path.dirname(absPath)).replace(/\\/g, "/");
                const parsed = content
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0 && !line.startsWith("#"))
                    .map((line) => this.normalizeIgnorePattern(line, relDir));
                patterns.push(...parsed);
            } catch {
                continue;
            }
        }
        return patterns;
    }

    private collectIgnoreFiles(rootPath: string): string[] {
        const ignoreFiles: string[] = [];
        const stack = [rootPath];
        while (stack.length > 0) {
            const current = stack.pop()!;
            let entries: fs.Dirent[] = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.isSymbolicLink()) continue;
                const entryPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    if (DEFAULT_IGNORE_DIRS.includes(entry.name)) {
                        continue;
                    }
                    stack.push(entryPath);
                    continue;
                }
                if (entry.name === ".gitignore" || entry.name === ".mcpignore") {
                    ignoreFiles.push(entryPath);
                }
            }
        }
        return ignoreFiles;
    }

    private normalizeIgnorePattern(pattern: string, relDir: string): string {
        if (!pattern) return pattern;
        let negation = "";
        let normalized = pattern;
        if (normalized.startsWith("!")) {
            negation = "!";
            normalized = normalized.slice(1);
        }
        if (normalized.startsWith("/")) {
            normalized = normalized.slice(1);
        }
        if (relDir && relDir.length > 0) {
            normalized = `${relDir}/${normalized}`;
        }
        return `${negation}${normalized}`;
    }

    private scanLanguages(
        rootPath: string,
        baseDir: string,
        ignoreFilter: any,
        languageConfig: LanguageConfigLoader,
        options: { maxFiles: number; includeDocs: boolean; sampleBytesPerFile: number }
    ): { languages: LanguageShare[]; unknownExtensions: string[]; truncated: boolean } {
        const extCounts = new Map<string, number>();
        const unknownExtensions = new Set<string>();
        let total = 0;
        let truncated = false;

        const baseAbs = path.resolve(baseDir);
        const stack = [baseAbs];

        while (stack.length > 0) {
            if (total >= options.maxFiles) {
                truncated = true;
                break;
            }
            const current = stack.pop()!;
            let entries: fs.Dirent[] = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (total >= options.maxFiles) {
                    truncated = true;
                    break;
                }
                if (entry.isSymbolicLink()) continue;
                const absPath = path.join(current, entry.name);
                const relPath = path.relative(rootPath, absPath).replace(/\\/g, "/");
                if (relPath && ignoreFilter.ignores(relPath)) {
                    continue;
                }
                if (entry.isDirectory()) {
                    stack.push(absPath);
                    continue;
                }
                if (!entry.isFile()) continue;
                const ext = path.extname(entry.name).toLowerCase();
                if (!ext) continue;
                if (!options.includeDocs && (ext === ".md" || ext === ".mdx")) {
                    continue;
                }
                const mapping = languageConfig.getLanguageMapping(ext);
                if (!mapping) {
                    unknownExtensions.add(ext);
                    continue;
                }
                total += 1;
                extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
            }
        }

        const languageCounts = new Map<string, number>();
        for (const [ext, count] of extCounts.entries()) {
            const mapping = languageConfig.getLanguageMapping(ext);
            if (!mapping) continue;
            const languageId = mapping.languageId;
            languageCounts.set(languageId, (languageCounts.get(languageId) ?? 0) + count);
        }

        const languages: LanguageShare[] = [];
        for (const [languageId, count] of languageCounts.entries()) {
            const support = getSupportForLanguageId(languageId);
            languages.push({
                languageId,
                supportLevel: support?.level === SupportLevel.L3 ? "L3" : support ? "L2" : undefined,
                share: total > 0 ? count / total : 0
            });
        }

        languages.sort((a, b) => b.share - a.share);

        return {
            languages,
            unknownExtensions: Array.from(unknownExtensions.values()).sort(),
            truncated
        };
    }

    private detectRepositories(
        rootPath: string,
        ignoreFilter: any,
        languageConfig: LanguageConfigLoader,
        options: { maxFiles: number; includeDocs: boolean; sampleBytesPerFile: number },
        multiRepoMode: "auto" | "single" | "detect",
        globalScan: { languages: LanguageShare[] }
    ): RepoSummary[] {
        const repos: RepoSummary[] = [];
        const repoPaths = new Set<string>();

        const rootLanguages = globalScan.languages.map((lang) => lang.languageId);
        repos.push({
            id: "main",
            path: ".",
            name: "Main Repo",
            type: "primary",
            languages: rootLanguages,
            allowCrossRepoEdits: false,
            excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS]
        });
        repoPaths.add(path.resolve(rootPath));

        if (multiRepoMode === "single") {
            return repos;
        }

        const candidates: Array<{ path: string; type: "linked" | "reference"; name?: string }> = [];
        candidates.push(...this.detectCargoCrates(rootPath));
        candidates.push(...this.detectNodePackages(rootPath, "packages"));
        candidates.push(...this.detectNodePackages(rootPath, "apps"));
        candidates.push(...this.detectWorkspacePackages(rootPath));

        for (const candidate of candidates) {
            const absPath = path.resolve(rootPath, candidate.path);
            if (repoPaths.has(absPath)) continue;
            if (!fs.existsSync(absPath)) continue;
            const langScan = this.scanLanguages(rootPath, absPath, ignoreFilter, languageConfig, {
                ...options,
                maxFiles: Math.min(options.maxFiles, 5000)
            });
            const repoId = this.slugify(path.basename(candidate.path));
            repos.push({
                id: repoId,
                path: candidate.path,
                name: candidate.name ?? this.titleCase(repoId.replace(/-/g, " ")),
                type: candidate.type,
                languages: langScan.languages.map((lang) => lang.languageId),
                allowCrossRepoEdits: false,
                excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS]
            });
            repoPaths.add(absPath);
        }

        return repos;
    }

    private detectCargoCrates(rootPath: string): Array<{ path: string; type: "linked"; name?: string }> {
        const cratesDir = path.join(rootPath, "crates");
        if (!fs.existsSync(cratesDir)) return [];
        const entries = fs.readdirSync(cratesDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({
                path: path.join("crates", entry.name),
                type: "linked" as const,
                name: `Crate ${entry.name}`
            }))
            .filter((candidate) => fs.existsSync(path.join(rootPath, candidate.path, "Cargo.toml")));
    }

    private detectNodePackages(rootPath: string, baseDir: string): Array<{ path: string; type: "linked"; name?: string }> {
        const dir = path.join(rootPath, baseDir);
        if (!fs.existsSync(dir)) return [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({
                path: path.join(baseDir, entry.name),
                type: "linked" as const,
                name: `Package ${entry.name}`
            }))
            .filter((candidate) => fs.existsSync(path.join(rootPath, candidate.path, "package.json")));
    }

    private detectWorkspacePackages(rootPath: string): Array<{ path: string; type: "linked"; name?: string }> {
        const packageJsonPath = path.join(rootPath, "package.json");
        if (!fs.existsSync(packageJsonPath)) return [];
        let parsed: any;
        try {
            parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        } catch {
            return [];
        }
        const workspaces = Array.isArray(parsed?.workspaces)
            ? parsed.workspaces
            : Array.isArray(parsed?.workspaces?.packages)
                ? parsed.workspaces.packages
                : [];
        const candidates: Array<{ path: string; type: "linked"; name?: string }> = [];
        for (const workspace of workspaces) {
            if (typeof workspace !== "string") continue;
            const resolved = this.expandWorkspacePattern(rootPath, workspace);
            for (const entry of resolved) {
                candidates.push({
                    path: entry,
                    type: "linked",
                    name: `Workspace ${path.basename(entry)}`
                });
            }
        }
        return candidates;
    }

    private expandWorkspacePattern(rootPath: string, pattern: string): string[] {
        if (!pattern.includes("*")) {
            return [pattern];
        }
        if (pattern.includes("**")) {
            return [];
        }
        const normalized = pattern.replace(/\\/g, "/");
        if (!normalized.endsWith("/*")) {
            return [];
        }
        const baseDir = normalized.slice(0, -2);
        const absBase = path.join(rootPath, baseDir);
        if (!fs.existsSync(absBase)) return [];
        const entries = fs.readdirSync(absBase, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(baseDir, entry.name))
            .filter((candidate) => fs.existsSync(path.join(rootPath, candidate)));
    }

    private detectWasm(languageIds: string[], rootPath: string) {
        const required = Array.from(new Set(languageIds));
        const found: string[] = [];
        const missing: string[] = [];
        const suggestedWasmDir = path.join(rootPath, "wasm");

        for (const languageId of required) {
            const wasmPath = this.resolveWasmPath(languageId, rootPath);
            if (wasmPath && fs.existsSync(wasmPath)) {
                found.push(languageId);
            } else {
                missing.push(languageId);
            }
        }

        return { required, found, missing, suggestedWasmDir };
    }

    private resolveWasmPath(languageId: string, rootPath: string): string | null {
        const overrideDir = (process.env.KAIRO_WASM_DIR || "").trim();
        if (overrideDir) {
            return path.resolve(overrideDir, `tree-sitter-${languageId}.wasm`);
        }

        const candidates: string[] = [];
        const localRequire = createRequire(import.meta.url);
        try {
            const pkgPath = localRequire.resolve("tree-sitter-wasms/package.json");
            const pkgDir = path.dirname(pkgPath);
            candidates.push(path.join(pkgDir, "out", `tree-sitter-${languageId}.wasm`));
        } catch {
            // ignore
        }

        candidates.push(path.join(rootPath, "node_modules", "tree-sitter-wasms", "out", `tree-sitter-${languageId}.wasm`));
        candidates.push(path.join(rootPath, "wasm", `tree-sitter-${languageId}.wasm`));

        return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[candidates.length - 1] ?? null;
    }

    private detectQueryGaps(languageIds: string[]) {
        const queriesRoot = this.resolveQueriesRoot();
        const gaps: Array<{ languageId: string; missing: string[]; supportLevel?: "L2" | "L3" }> = [];
        if (!queriesRoot) {
            return gaps;
        }
        const uniqueIds = Array.from(new Set(languageIds));
        for (const languageId of uniqueIds) {
            const support = getSupportForLanguageId(languageId);
            const required = support?.editPolicy.requireQueries ?? [];
            if (required.length === 0) continue;
            const missing: string[] = [];
            const candidates = this.resolveQueryCandidates(languageId);
            for (const query of required) {
                let found = false;
                for (const candidate of candidates) {
                    const queryPath = path.join(queriesRoot, candidate, `${query}.scm`);
                    if (fs.existsSync(queryPath)) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    missing.push(query);
                }
            }
            if (missing.length > 0) {
                gaps.push({
                    languageId,
                    missing,
                    supportLevel: support?.level === SupportLevel.L3 ? "L3" : support ? "L2" : undefined
                });
            }
        }
        return gaps;
    }

    private resolveQueriesRoot(): string | null {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        let queriesRoot = path.resolve(__dirname, "..", "queries");
        if (!fs.existsSync(queriesRoot)) {
            queriesRoot = path.resolve(process.cwd(), "src", "queries");
        }
        if (!fs.existsSync(queriesRoot)) {
            return null;
        }
        return queriesRoot;
    }

    private resolveQueryCandidates(languageId: string): string[] {
        const normalized = (languageId ?? "").toLowerCase();
        const aliases: Record<string, string[]> = {
            ts: ["typescript"],
            tsx: ["typescript"],
            javascript: ["typescript"],
            js: ["typescript"],
            md: ["markdown"],
            mdx: ["markdown"],
            py: ["python"],
            rs: ["rust"]
        };
        return [normalized, ...(aliases[normalized] ?? [])];
    }

    private buildQueryGapFindings(gaps: Array<{ languageId: string; missing: string[]; supportLevel?: "L2" | "L3" }>): ConfigFinding[] {
        return gaps.map((gap) => ({
            code: "LANGUAGE_GAP",
            severity: gap.supportLevel === "L3" ? "error" : "warn",
            message: `Missing query packs for ${gap.languageId}: ${gap.missing.join(", ")}.`,
            action: "add_query_packs",
            evidence: { languageId: gap.languageId, missing: gap.missing }
        }));
    }

    private buildWasmFindings(wasm: BootstrapDetected["wasm"], languages: LanguageShare[]): ConfigFinding[] {
        const findings: ConfigFinding[] = [];
        const languageMap = new Map(languages.map((lang) => [lang.languageId, lang.supportLevel]));
        for (const missing of wasm.missing) {
            const level = languageMap.get(missing);
            findings.push({
                code: "WASM_MISSING",
                severity: level === "L3" ? "error" : "warn",
                message: `Missing tree-sitter WASM for ${missing}.`,
                action: "add_wasm",
                evidence: { languageId: missing }
            });
        }
        return findings;
    }

    private buildParityFindings(rootPath: string): { findings: ConfigFinding[]; hints: string[] } {
        const findings: ConfigFinding[] = [];
        const hints: string[] = [];
        const mappedLanguageIds = new Set(
            Object.values(BUILTIN_LANGUAGE_MAPPINGS)
                .map((mapping) => mapping.languageId)
                .filter((id): id is string => typeof id === "string")
        );
        const queriesRoot = this.resolveQueriesRoot();
        for (const entry of LANGUAGE_PARITY_MATRIX.languages) {
            const severity = entry.supportLevel === "L3" ? "error" : "warn";
            if (!mappedLanguageIds.has(entry.languageId)) {
                findings.push({
                    code: "LANGUAGE_SUPPORT_GAP",
                    severity,
                    message: `No LanguageConfig mapping for "${entry.languageId}".`,
                    action: "add_language_mappings",
                    evidence: { languageId: entry.languageId }
                });
            }

            if (entry.requiredQueryPack) {
                const missing: string[] = [];
                const candidates = this.resolveQueryCandidates(entry.languageId);
                const requiredQueries = resolveRequiredQueries(entry);
                for (const query of requiredQueries) {
                    let found = false;
                    if (queriesRoot) {
                        for (const candidate of candidates) {
                            const queryPath = path.join(queriesRoot, candidate, `${query}.scm`);
                            if (fs.existsSync(queryPath)) {
                                found = true;
                                break;
                            }
                        }
                    }
                    if (!found) {
                        missing.push(query);
                    }
                }
                if (missing.length > 0) {
                    findings.push({
                        code: "MISSING_QUERY_PACK",
                        severity,
                        message: `Missing query packs for ${entry.languageId}: ${missing.join(", ")}.`,
                        action: "add_query_packs",
                        evidence: { languageId: entry.languageId, missing }
                    });
                    hints.push(`Missing query packs for ${entry.languageId}. Add ${missing.join(", ")} under ${path.join("src", "queries", entry.languageId)}.`);
                }
            }

            if (entry.requiredWasmGrammar) {
                const wasmPath = this.resolveWasmPath(entry.languageId, rootPath);
                if (!wasmPath || !fs.existsSync(wasmPath)) {
                    findings.push({
                        code: "MISSING_WASM_GRAMMAR",
                        severity,
                        message: `Missing tree-sitter WASM for ${entry.languageId}.`,
                        action: "add_wasm",
                        evidence: { languageId: entry.languageId }
                    });
                    hints.push(`Missing WASM for ${entry.languageId}. Set KAIRO_WASM_DIR or add tree-sitter-${entry.languageId}.wasm to ${path.join(rootPath, "wasm")}.`);
                }
            }

            if (entry.requiredSyntaxValidator && !mappedLanguageIds.has(entry.languageId)) {
                findings.push({
                    code: "MISSING_VALIDATOR",
                    severity,
                    message: `Missing syntax validator mapping for ${entry.languageId}.`,
                    action: "add_language_mappings",
                    evidence: { languageId: entry.languageId }
                });
            }
        }

        return { findings, hints };
    }

    private buildMcpConfigPlan(
        configPath: string,
        repos: RepoSummary[],
        repoSeedConfig: any,
        policyConfig: Record<string, unknown>,
        findings: ConfigFinding[]
    ): ConfigWriteOp {
        const existing = this.readJsonFile(configPath);
        const baseConfig = existing.value
            ? this.buildRepoConfig(repos)
            : (repoSeedConfig ?? this.buildRepoConfig(repos));
        if (existing.value) {
            const conflict = this.detectRepoConflicts(existing.value, baseConfig);
            if (conflict) {
                findings.push(conflict);
                return { op: "noop", path: configPath, reason: "Repository config conflict detected." };
            }
            const repoPatch = this.buildMissingPatch(existing.value, baseConfig);
            const policyPatch = this.buildMissingPatch(existing.value, policyConfig);
            const mergedPatch = this.deepMerge(repoPatch ?? {}, policyPatch ?? {});
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
        const policyPatch = this.buildMissingPatch(baseConfig, policyConfig);
        const combined = policyPatch ? this.deepMerge(baseConfig, policyPatch) : baseConfig;
        return {
            op: "create",
            path: configPath,
            content: JSON.stringify(combined, null, 2)
        };
    }

    private detectRepoConflicts(existing: any, desired: any): ConfigFinding | null {
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
    }

    private buildRepoConfig(repos: RepoSummary[]) {
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
    }

    private normalizeLegacyMultiRepo(legacy: any) {
        const repositories = legacy?.repositories ?? {};
        const defaultRepo = legacy?.defaultRepo ?? Object.keys(repositories)[0] ?? "main";
        return {
            version: legacy?.version ?? "1.0",
            defaultRepo,
            repositories
        };
    }

    private buildLanguagesConfigPlan(configPath: string, legacyLanguages: any): ConfigWriteOp | null {
        if (!legacyLanguages) {
            return null;
        }
        const existing = this.readJsonFile(configPath);
        if (existing.value) {
            const patch = this.buildMissingPatch(existing.value, legacyLanguages);
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
    }

    private buildGraphRagConfigPlan(configPath: string): ConfigWriteOp | null {
        const existing = this.readJsonFile(configPath);
        if (existing.value) {
            const patch = this.buildMissingPatch(existing.value, DEFAULT_GRAPHRAG_CONFIG);
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
    }

    private buildMcpPolicyConfig(legacyConfig?: any): Record<string, unknown> {
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
    }

    private buildVscodePlan(configPath: string, preset: HostPreset, rootPath: string): ConfigWriteOp | null {
        const env = this.buildVscodeEnv(preset, rootPath);
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

        const existing = this.readJsonFile(configPath);
        if (existing.value) {
            const patch = this.buildMissingPatch(existing.value, baseConfig);
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
    }

    private buildVscodeEnv(preset: HostPreset, rootPath: string): Record<string, string> {
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
    }

    private buildMissingPatch(existing: any, desired: any): Record<string, unknown> | null {
        const patch = this.mergeMissing(existing, desired);
        if (!patch || Object.keys(patch).length === 0) {
            return null;
        }
        return patch as Record<string, unknown>;
    }

    private mergeMissing(existing: any, desired: any): any {
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
            const nested = this.mergeMissing((existing as any)[key], value);
            if (nested && typeof nested === "object" && Object.keys(nested).length > 0) {
                patch[key] = nested;
            }
        }
        return patch;
    }

    private readJsonFile(filePath: string): { value?: any; error?: string; hash?: string } {
        if (!fs.existsSync(filePath)) {
            return {};
        }
        try {
            const raw = fs.readFileSync(filePath, "utf-8");
            return {
                value: JSON.parse(raw),
                hash: this.hashContent(raw)
            };
        } catch (error: any) {
            return { error: error?.message ?? "Unknown parse error" };
        }
    }

    private hashContent(content: string): string {
        return crypto.createHash("sha256").update(content).digest("hex");
    }

    private resolveStatus(findings: ConfigFinding[]): "ok" | "degraded" | "needs_action" {
        const hasError = findings.some((finding) => finding.severity === "error");
        if (hasError) return "needs_action";
        const hasWarn = findings.some((finding) => finding.severity === "warn");
        if (hasWarn) return "degraded";
        return "ok";
    }

    private buildSummary(
        operation: string,
        plan: ConfigWriteOp[],
        findings: ConfigFinding[],
        mode: BootstrapMode
    ): string {
        const actionable = plan.filter((op) => op.op !== "noop").length;
        const errorCount = findings.filter((f) => f.severity === "error").length;
        if (mode === "apply") {
            return `${operation} applied ${actionable} changes with ${errorCount} errors detected.`;
        }
        return `${operation} produced ${actionable} planned changes with ${errorCount} blocking findings.`;
    }

    private applyScope(
        scope: ManageDoctorArgs["scope"] | undefined,
        input: { findings: ConfigFinding[]; plan: ConfigWriteOp[]; hints: string[] }
    ): { findings: ConfigFinding[]; plan: ConfigWriteOp[]; hints: string[] } {
        if (!scope) return input;
        const findings = input.findings.filter((finding) => this.isFindingInScope(scope, finding));
        const plan = input.plan.filter((entry) => this.isPlanInScope(scope, entry.path));
        const hints = input.hints.filter((hint) => this.isHintInScope(scope, hint));
        return { findings, plan, hints };
    }

    private isFindingInScope(scope: ManageDoctorArgs["scope"], finding: ConfigFinding): boolean {
        if (!scope) return true;
        const code = finding.code;
        switch (scope) {
            case "capabilities":
                return false;
            case "languages":
                return code === "LANGUAGE_GAP" || code === "SCAN_TRUNCATED";
            case "wasm":
                return code === "WASM_MISSING";
            case "parity":
                return code === "MISSING_QUERY_PACK"
                    || code === "MISSING_WASM_GRAMMAR"
                    || code === "MISSING_VALIDATOR"
                    || code === "LANGUAGE_SUPPORT_GAP";
            case "host":
                return code === "HOST_CONFIG_MISSING" || code === "HOST_CONFIG_PATCH";
            case "config":
                return code === "CONFIG_PARSE_ERROR" || code === "MIGRATION_NEEDED" || code === "CONFIG_CONFLICT";
            case "contracts":
                return code.startsWith("CONTRACT");
            case "project":
                return true;
            default:
                return true;
        }
    }

    private isPlanInScope(scope: ManageDoctorArgs["scope"], filePath: string): boolean {
        if (!scope) return true;
        if (scope === "host") {
            return filePath.replace(/\\\\/g, "/").endsWith("/.vscode/mcp.json");
        }
        if (scope === "capabilities") {
            return false;
        }
        if (scope === "wasm") {
            return false;
        }
        if (scope === "languages") {
            return filePath.replace(/\\\\/g, "/").endsWith("/.kairo/config/languages.json");
        }
        if (scope === "config") {
            const normalized = filePath.replace(/\\\\/g, "/");
            return normalized.endsWith("/.mcp-config.json")
                || normalized.endsWith("/.kairo/config/mcp-config.json")
                || normalized.endsWith("/.kairo/config/mcp.json")
                || normalized.endsWith("/.kairo/config/languages.json")
                || normalized.endsWith("/.kairo/config/graphrag.json");
        }
        if (scope === "contracts") {
            return filePath.replace(/\\\\/g, "/").includes("/.kairo/contracts");
        }
        if (scope === "parity") {
            const normalized = filePath.replace(/\\\\/g, "/");
            return normalized.endsWith("/.kairo/config/languages.json")
                || normalized.includes("/wasm/");
        }
        return true;
    }

    private isHintInScope(scope: ManageDoctorArgs["scope"], hint: string): boolean {
        if (!scope) return true;
        if (scope === "wasm") {
            return hint.includes("KAIRO_WASM_DIR");
        }
        if (scope === "capabilities") {
            return false;
        }
        if (scope === "languages") {
            return hint.includes("extensions") || hint.includes("mappings");
        }
        if (scope === "host") {
            return hint.includes(".vscode");
        }
        if (scope === "config") {
            return hint.includes(".mcp-config") || hint.includes(".kairo/config");
        }
        if (scope === "contracts") {
            return hint.includes(".kairo/contracts") || hint.includes("contracts");
        }
        if (scope === "parity") {
            const normalized = hint.toLowerCase();
            return normalized.includes("query") || normalized.includes("wasm") || normalized.includes("validator");
        }
        return true;
    }

    private buildContractFindings(rootPath: string, repos: RepoSummary[]): { findings: ConfigFinding[]; hints: string[] } {
        const findings: ConfigFinding[] = [];
        const hints: string[] = [];
        const contractsDir = path.join(rootPath, ".kairo", "contracts");
        if (!fs.existsSync(contractsDir)) {
            findings.push({
                code: "CONTRACTS_DIR_MISSING",
                severity: "warn",
                message: "Contracts directory is missing (.kairo/contracts).",
                action: "init_contracts",
                evidence: { path: contractsDir }
            });
            hints.push(`Create ${contractsDir} or run a build step that generates contract manifests.`);
            return { findings, hints };
        }

        const entries = fs.readdirSync(contractsDir, { withFileTypes: true });
        const hasManifest = entries.some((entry) => entry.isDirectory() || entry.isFile());
        if (!hasManifest) {
            findings.push({
                code: "CONTRACTS_EMPTY",
                severity: "warn",
                message: "Contracts directory exists but no manifests were found.",
                action: "generate_contracts",
                evidence: { path: contractsDir }
            });
            hints.push("Generate contract manifests (e.g. NAPI d.ts manifest) to enable cross-language impact.");
        }

        const linkedRepos = repos.filter((repo) => repo.type === "linked");
        const manifestLoader = new ContractManifestLoader(rootPath);
        for (const repo of linkedRepos) {
            const repoPath = path.resolve(rootPath, repo.path);
            const packageJsonPath = path.join(repoPath, "package.json");
            if (!fs.existsSync(packageJsonPath)) {
                findings.push({
                    code: "CONTRACT_ALIAS_MISSING",
                    severity: "warn",
                    message: `Linked repo "${repo.id}" is missing package.json; cannot map package alias.`,
                    action: "add_package_name",
                    evidence: { path: repoPath, repoId: repo.id }
                });
                hints.push(`Add package.json with name field in ${repoPath} to enable alias mapping.`);
                continue;
            }

            let pkg: { name?: string; types?: string; typings?: string; main?: string } | undefined;
            try {
                pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            } catch {
                findings.push({
                    code: "CONTRACT_ALIAS_INVALID",
                    severity: "warn",
                    message: `Linked repo "${repo.id}" has invalid package.json; cannot map package alias.`,
                    action: "fix_package_json",
                    evidence: { path: packageJsonPath, repoId: repo.id }
                });
                continue;
            }

            if (!pkg?.name) {
                findings.push({
                    code: "CONTRACT_ALIAS_INVALID",
                    severity: "warn",
                    message: `Linked repo "${repo.id}" package.json is missing name; cannot map package alias.`,
                    action: "add_package_name",
                    evidence: { path: packageJsonPath, repoId: repo.id }
                });
            }

            if (pkg?.name) {
                const manifestResult = manifestLoader.loadManifest(pkg.name, "ffi_napi");
                if (manifestResult.reason === "contract_manifest_missing") {
                    findings.push({
                        code: "CONTRACT_MANIFEST_MISSING",
                        severity: "warn",
                        message: `Contract manifest for "${pkg.name}" not found.`,
                        action: "generate_contracts",
                        evidence: { packageName: pkg.name, repoId: repo.id }
                    });
                    hints.push(`Generate contract manifest for ${pkg.name} (e.g. run build in ${repoPath}).`);
                } else if (manifestResult.reason === "contract_manifest_invalid") {
                    findings.push({
                        code: "CONTRACT_MANIFEST_INVALID",
                        severity: "warn",
                        message: `Contract manifest for "${pkg.name}" is invalid.`,
                        action: "regenerate_contracts",
                        evidence: { packageName: pkg.name, repoId: repo.id }
                    });
                    hints.push(`Regenerate contract manifest for ${pkg.name} to fix invalid schema.`);
                } else if (manifestResult.stale) {
                    findings.push({
                        code: "CONTRACT_MANIFEST_STALE",
                        severity: "warn",
                        message: `Contract manifest for "${pkg.name}" is stale.`,
                        action: "regenerate_contracts",
                        evidence: { packageName: pkg.name, repoId: repo.id }
                    });
                    hints.push(`Regenerate contract manifest for ${pkg.name} to pick up recent changes.`);
                }
            }

            if (!pkg) {
                continue;
            }

            const entry = this.resolvePackageEntry(repoPath, pkg);
            if (!entry) {
                findings.push({
                    code: "CONTRACT_ALIAS_ENTRY_MISSING",
                    severity: "warn",
                    message: `Linked repo "${repo.id}" has no resolvable entry file for alias mapping.`,
                    action: "add_entry_file",
                    evidence: { path: packageJsonPath, repoId: repo.id }
                });
                hints.push(`Add types/main or index.d.ts for ${repoPath} to enable cross-language alias mapping.`);
            }
        }

        return { findings, hints };
    }

    private buildContractPlan(rootPath: string, repos: RepoSummary[]): ConfigWriteOp[] {
        const plan: ConfigWriteOp[] = [];
        const contractsDir = path.join(rootPath, ".kairo", "contracts");
        const napiDir = path.join(contractsDir, "ffi_napi");
        if (!fs.existsSync(contractsDir)) {
            plan.push({
                op: "mkdir",
                path: contractsDir,
                reason: "Create contracts directory."
            });
        }
        if (!fs.existsSync(napiDir)) {
            plan.push({
                op: "mkdir",
                path: napiDir,
                reason: "Create NAPI contracts directory."
            });
        }

        const manifestLoader = new ContractManifestLoader(rootPath);
        const generator = new ContractManifestGenerator();
        const linkedRepos = repos.filter((repo) => repo.type === "linked");

        for (const repo of linkedRepos) {
            const repoPath = path.resolve(rootPath, repo.path);
            const packageJsonPath = path.join(repoPath, "package.json");
            if (!fs.existsSync(packageJsonPath)) continue;

            let pkg: { name?: string; types?: string; typings?: string; main?: string } | undefined;
            try {
                pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            } catch {
                continue;
            }
            if (!pkg?.name) continue;

            const entry = this.resolvePackageEntry(repoPath, pkg);
            if (!entry || !entry.endsWith(".d.ts") || !fs.existsSync(entry)) {
                continue;
            }

            const manifestPath = manifestLoader.resolveManifestPath(pkg.name, "ffi_napi");
            if (fs.existsSync(manifestPath)) {
                continue;
            }

            try {
                const manifest = generator.generateFromDts(pkg.name, entry, { sourceRepo: repo.path });
                plan.push({
                    op: "create",
                    path: manifestPath,
                    content: JSON.stringify(manifest, null, 2),
                    reason: `Generate contract manifest for ${pkg.name}.`
                });
            } catch {
                // ignore plan generation failures; doctor will surface findings
            }
        }

        return plan;
    }

    private resolvePackageEntry(
        repoPath: string,
        pkg: { types?: string; typings?: string; main?: string }
    ): string | undefined {
        const candidates = [pkg.types, pkg.typings, pkg.main].filter(Boolean) as string[];
        for (const candidate of candidates) {
            const resolved = this.resolvePackageEntryCandidate(repoPath, candidate);
            if (resolved) return resolved;
        }
        return this.resolvePackageEntryCandidate(repoPath, "index");
    }

    private resolvePackageEntryCandidate(repoPath: string, candidate: string): string | undefined {
        const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(repoPath, candidate);
        if (fs.existsSync(absolute)) {
            const stat = fs.statSync(absolute);
            if (stat.isFile()) return absolute;
            if (stat.isDirectory()) {
                return this.resolvePackageEntryCandidate(absolute, "index");
            }
        }
        const extensions = [".d.ts", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
        for (const ext of extensions) {
            const resolved = `${absolute}${ext}`;
            if (fs.existsSync(resolved)) return resolved;
        }
        return undefined;
    }

    private async applyPlan(plan: ConfigWriteOp[], options?: ManageInitArgs["applyOptions"]): Promise<BootstrapApplyResult[]> {
        const results: BootstrapApplyResult[] = [];
        const backup = options?.backup !== false;
        for (const entry of plan) {
            if (entry.op === "noop") {
                results.push({ path: entry.path, op: entry.op, success: true, message: entry.reason ?? "No changes." });
                continue;
            }
            if (entry.op === "create") {
                if (fs.existsSync(entry.path)) {
                    results.push({ path: entry.path, op: entry.op, success: false, message: "File already exists." });
                    continue;
                }
                fs.mkdirSync(path.dirname(entry.path), { recursive: true });
                fs.writeFileSync(entry.path, entry.content ?? "", "utf-8");
                results.push({ path: entry.path, op: entry.op, success: true, message: "File created." });
                continue;
            }
            if (entry.op === "mkdir") {
                if (fs.existsSync(entry.path)) {
                    const stat = fs.statSync(entry.path);
                    if (stat.isDirectory()) {
                        results.push({ path: entry.path, op: entry.op, success: true, message: "Directory already exists." });
                    } else {
                        results.push({ path: entry.path, op: entry.op, success: false, message: "Path exists and is not a directory." });
                    }
                    continue;
                }
                fs.mkdirSync(entry.path, { recursive: true });
                results.push({ path: entry.path, op: entry.op, success: true, message: "Directory created." });
                continue;
            }
            if (entry.op === "update") {
                if (!fs.existsSync(entry.path)) {
                    results.push({ path: entry.path, op: entry.op, success: false, message: "File not found." });
                    continue;
                }
                const raw = fs.readFileSync(entry.path, "utf-8");
                if (entry.patch?.beforeHash && this.hashContent(raw) !== entry.patch.beforeHash) {
                    results.push({ path: entry.path, op: entry.op, success: false, message: "File changed since plan." });
                    continue;
                }
                if (backup) {
                    const backupPath = `${entry.path}.bak.${Date.now()}`;
                    fs.writeFileSync(backupPath, raw, "utf-8");
                }
                let parsed: any;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    results.push({ path: entry.path, op: entry.op, success: false, message: "JSON parse failed." });
                    continue;
                }
                const merged = this.deepMerge(parsed, entry.patch?.jsonMerge ?? {});
                if (entry.patch?.removeKeys && entry.patch.removeKeys.length > 0) {
                    for (const key of entry.patch.removeKeys) {
                        delete (merged as any)[key];
                    }
                }
                fs.writeFileSync(entry.path, JSON.stringify(merged, null, 2), "utf-8");
                results.push({ path: entry.path, op: entry.op, success: true, message: "File updated." });
                continue;
            }
        }
        return results;
    }

    private deepMerge(target: any, patch: any): any {
        if (patch === undefined || patch === null) return target;
        if (typeof patch !== "object" || patch === null) return patch;
        if (Array.isArray(patch)) return patch;
        const output = { ...(target ?? {}) };
        for (const [key, value] of Object.entries(patch)) {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                output[key] = this.deepMerge((output as any)[key], value);
            } else {
                output[key] = value;
            }
        }
        return output;
    }

    private slugify(input: string): string {
        return input
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "repo";
    }

    private titleCase(input: string): string {
        return input
            .split(/\s+/)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }
}

function resolveBaseDir(): string {
    const raw = (process.env.KAIRO_DIR || "").trim();
    if (!raw) {
        return ".kairo";
    }
    const normalized = raw.replace(/\\/g, "/").replace(/\/+$/g, "");
    const allowLegacy = process.env.KAIRO_ALLOW_LEGACY_MCP_DIR === "true";
    if (!allowLegacy) {
        if (normalized === ".mcp" || normalized === ".mcp/kairo") {
            return ".kairo";
        }
        if (normalized.includes("/.mcp/")) {
            return ".kairo";
        }
    }
    return raw;
}
