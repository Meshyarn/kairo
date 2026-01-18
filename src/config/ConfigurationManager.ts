import chokidar from "chokidar";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import type { ValidationConfig, ValidationMode } from "../types/validation.js";

export type ConfigurationEvent =
    | "ignoreChanged"
    | "tsconfigChanged"
    | "jsconfigChanged"
    | "packageJsonChanged";

export interface ConfigurationEventPayloads {
    ignoreChanged: { filePath: string; patterns: string[] };
    tsconfigChanged: { filePath: string };
    jsconfigChanged: { filePath: string };
    packageJsonChanged: { filePath: string };
}

export type OverridePolicyConfig = {
    enabled?: boolean;
    maxTtlMinutes?: number;
    maxFiles?: number;
    allowed?: Record<string, boolean | "confirm_only">;
};

const WATCH_FILES = [
    "tsconfig.json",
    "jsconfig.json",
    "package.json"
];
const IGNORE_FILES = [".gitignore", ".mcpignore"];
const IGNORE_SCAN_EXCLUDES = new Set([
    ".git",
    "node_modules",
    ".mcp",
    ".kairo",
    ".kairo-index",
    "dist",
    "coverage"
]);

export class ConfigurationManager extends EventEmitter {
    private readonly watcher?: chokidar.FSWatcher;
    private ignorePatterns: string[];

    constructor(private readonly rootPath: string) {
        super();
        this.ignorePatterns = this.loadIgnorePatterns();
        
        const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
        if (!isTestEnv) {
            const ignoreTargets = this.collectIgnoreFiles();
            const watchTargets = [
                ...WATCH_FILES.map(file => path.join(this.rootPath, file)),
                ...ignoreTargets
            ];
            this.watcher = chokidar.watch(watchTargets, {
                ignoreInitial: true,
                persistent: true,
                awaitWriteFinish: {
                    stabilityThreshold: 200,
                    pollInterval: 100
                }
            });
            this.registerWatchHandlers();
        }
    }

    public getIgnoreGlobs(): string[] {
        return [...this.ignorePatterns];
    }

    public on<T extends ConfigurationEvent>(event: T, listener: (payload: ConfigurationEventPayloads[T]) => void): this {
        return super.on(event, listener);
    }

    public off<T extends ConfigurationEvent>(event: T, listener: (payload: ConfigurationEventPayloads[T]) => void): this {
        return super.off(event, listener);
    }

    public async dispose(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close();
        }
        this.removeAllListeners();
    }

    private registerWatchHandlers(): void {
        if (!this.watcher) return;
        const handler = (filePath: string) => this.handleConfigChange(filePath);
        this.watcher.on("add", handler);
        this.watcher.on("change", handler);
        this.watcher.on("unlink", handler);
        this.watcher.on("error", error => {
            console.warn("[ConfigurationManager] watcher error", error);
        });
    }

    private handleConfigChange(filePath: string): void {
        const basename = path.basename(filePath);
        switch (basename) {
            case ".gitignore":
            case ".mcpignore": {
                this.ignorePatterns = this.loadIgnorePatterns();
                this.emit("ignoreChanged", {
                    filePath,
                    patterns: [...this.ignorePatterns]
                });
                break;
            }
            case "tsconfig.json": {
                this.emit("tsconfigChanged", { filePath });
                break;
            }
            case "jsconfig.json": {
                this.emit("jsconfigChanged", { filePath });
                break;
            }
            case "package.json": {
                this.emit("packageJsonChanged", { filePath });
                break;
            }
            default:
                break;
        }
    }

    private loadIgnorePatterns(): string[] {
        const patterns: string[] = [];
        const ignoreFiles = this.collectIgnoreFiles();
        for (const absPath of ignoreFiles) {
            try {
                const content = fs.readFileSync(absPath, "utf-8");
                const relDir = path.relative(this.rootPath, path.dirname(absPath)).replace(/\\/g, "/");
                const parsed = content
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && !line.startsWith("#"))
                    .map(line => this.normalizeIgnorePattern(line, relDir));
                patterns.push(...parsed);
            } catch (error) {
                console.warn(`[ConfigurationManager] Failed to read ${path.basename(absPath)}:`, error);
            }
        }
        return patterns;
    }

    private collectIgnoreFiles(): string[] {
        const ignoreFiles: string[] = [];
        const stack = [this.rootPath];
        while (stack.length > 0) {
            const current = stack.pop()!;
            let entries: fs.Dirent[] = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.isSymbolicLink()) {
                    continue;
                }
                const entryPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    if (IGNORE_SCAN_EXCLUDES.has(entry.name)) {
                        continue;
                    }
                    stack.push(entryPath);
                    continue;
                }
                if (IGNORE_FILES.includes(entry.name)) {
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

    // ADR-042-005: Phase A4 - ENV Configuration Getters
    public static get(key: string, defaultValue?: any): any {
        const envValue = process.env[key];
        if (envValue === undefined) {
            return defaultValue;
        }
        // Boolean conversion
        if (defaultValue === true || defaultValue === false) {
            return envValue === 'true';
        }
        // Number conversion
        if (typeof defaultValue === 'number') {
            const parsed = Number(envValue);
            return isNaN(parsed) ? defaultValue : parsed;
        }
        // String or other types
        return envValue;
    }

    public static getEditorV2Enabled(): boolean {
        return ConfigurationManager.get('KAIRO_EDITOR_V2', false);
    }

    public static getEditorV2Mode(): 'off' | 'dryrun' | 'apply' {
        const mode = ConfigurationManager.get('KAIRO_EDITOR_V2_MODE', 'off');
        if (mode === 'dryrun' || mode === 'apply') {
            return mode;
        }
        return 'off';
    }

    public static getResolveTimeoutMs(): number {
        return ConfigurationManager.get('KAIRO_EDITOR_RESOLVE_TIMEOUT_MS', 1500);
    }

    public static getMinLevenshteinTargetLen(): number {
        return ConfigurationManager.get('KAIRO_CHANGE_MIN_LEVENSHTEIN_TARGET_LEN', 20);
    }

    public static getMaxLevenshteinFileBytes(): number {
        return ConfigurationManager.get('KAIRO_CHANGE_MAX_LEVENSHTEIN_FILE_BYTES', 100000);
    }

    public static getAllowAmbiguousAutoPick(): boolean {
        // v2 모드에서는 기본적으로 false
        const v2Enabled = ConfigurationManager.getEditorV2Enabled();
        const v2Mode = ConfigurationManager.getEditorV2Mode();
        if (v2Enabled && v2Mode !== 'off') {
            return ConfigurationManager.get('KAIRO_EDITOR_ALLOW_AMBIGUOUS_AUTOPICK', false);
        }
        // v1 모드에서는 기본적으로 true
        return ConfigurationManager.get('KAIRO_EDITOR_ALLOW_AMBIGUOUS_AUTOPICK', true);
    }

    // ADR-042-006: Layer 3 AI-Enhanced Features

    /**
     * Phase 1: Smart Fuzzy Match - Enable embedding-based symbol search
     */
    public static getLayer3SmartMatchEnabled(): boolean {
        return ConfigurationManager.get('KAIRO_LAYER3_SMART_MATCH', false);
    }

    /**
     * Phase 1: Confidence threshold for auto-resolving with smart match
     */
    public static getLayer3SmartMatchThreshold(): number {
        return ConfigurationManager.get('KAIRO_LAYER3_SMART_MATCH_THRESHOLD', 0.85);
    }

    /**
     * Phase 2: Symbol Impact Analysis - Enable AST-based breaking change detection
     */
    public static getLayer3SymbolImpactEnabled(): boolean {
        return ConfigurationManager.get('KAIRO_LAYER3_SYMBOL_IMPACT', false);
    }

    /**
     * Phase 2: Maximum CallGraph traversal depth for impact analysis
     */
    public static getLayer3ImpactMaxDepth(): number {
        return ConfigurationManager.get('KAIRO_LAYER3_IMPACT_MAX_DEPTH', 3);
    }

    /**
     * Phase 2.5/3: Code Generation - Enable AI-powered code generation
     */
    public static getLayer3CodeGenEnabled(): boolean {
        return ConfigurationManager.get('KAIRO_LAYER3_CODE_GEN', false);
    }

    /**
     * Phase 3: Number of similar files to analyze for pattern extraction
     */
    public static getLayer3GenSimilarCount(): number {
        return ConfigurationManager.get('KAIRO_LAYER3_GEN_SIMILAR_COUNT', 5);
    }

    public static getValidationConfig(): ValidationConfig {
        const defaults = ConfigurationManager.getDefaultValidationConfig();
        if (ConfigurationManager.get("MCP_VALIDATION_DISABLED", false) === true) {
            return { ...defaults, syntax: "off", semantic: "off", lspDiagnostics: "off" };
        }

        const fileConfig = ConfigurationManager.loadValidationConfig();
        const merged: ValidationConfig = { ...defaults, ...fileConfig };
        const baseSyntax = ConfigurationManager.parseValidationMode(
            typeof merged.syntax === "string" ? merged.syntax : undefined,
            defaults.syntax
        );
        const baseSemantic = ConfigurationManager.parseValidationMode(
            typeof merged.semantic === "string" ? merged.semantic : undefined,
            defaults.semantic
        );
        const baseLspDiagnostics = ConfigurationManager.parseValidationMode(
            typeof merged.lspDiagnostics === "string" ? merged.lspDiagnostics : undefined,
            defaults.lspDiagnostics
        );
        const baseTimeout = ConfigurationManager.parseValidationTimeout(
            typeof merged.timeoutMs === "string" ? merged.timeoutMs : undefined,
            typeof merged.timeoutMs === "number" ? merged.timeoutMs : defaults.timeoutMs
        );

        const syntax = ConfigurationManager.parseValidationMode(
            process.env.MCP_VALIDATION_SYNTAX,
            baseSyntax
        );
        const semantic = ConfigurationManager.parseValidationMode(
            process.env.MCP_VALIDATION_SEMANTIC,
            baseSemantic
        );
        const lspDiagnostics = ConfigurationManager.parseValidationMode(
            process.env.MCP_VALIDATION_LSP,
            baseLspDiagnostics
        );
        const timeoutMs = ConfigurationManager.parseValidationTimeout(
            process.env.MCP_VALIDATION_TIMEOUT,
            baseTimeout
        );

        return {
            syntax,
            semantic,
            lspDiagnostics,
            timeoutMs
        };
    }

    private static loadValidationConfig(): Partial<ValidationConfig> {
        const configPath = path.join(process.cwd(), ".mcp-config.json");
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
    }

    private static getDefaultValidationConfig(): ValidationConfig {
        return {
            syntax: "warn",
            semantic: "off",
            lspDiagnostics: "off",
            timeoutMs: 2000
        };
    }

    public static getArchitecturalSafetyConfig(): {
        enabled: boolean;
        coreThreshold: number;
        blockPolicy: string;
        maxDepth: number;
    } {
        const fileConfig = ConfigurationManager.loadArchitecturalSafetyConfig();
        return {
            enabled: ConfigurationManager.get("KAIRO_ARCH_SAFETY_ENABLED", fileConfig.enabled ?? true),
            coreThreshold: ConfigurationManager.get("KAIRO_CORE_THRESHOLD", fileConfig.coreThreshold ?? 0.3),
            blockPolicy: ConfigurationManager.get("KAIRO_ARCH_SAFETY_BLOCK_POLICY", fileConfig.blockPolicy ?? "warn_only"),
            maxDepth: ConfigurationManager.get("KAIRO_CYCLE_MAX_DEPTH", fileConfig.maxDepth ?? 8)
        };
    }

    public static getIntegrityGuardrailsConfig(): {
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
    } {
        const fileConfig = ConfigurationManager.loadIntegrityGuardrailsConfig();
        return {
            enabled: ConfigurationManager.get("KAIRO_GUARDRAILS_ENABLED", fileConfig.enabled ?? true),
            layerRules: fileConfig.layerRules,
            coreProtection: {
                pageRankThreshold: ConfigurationManager.get("KAIRO_CORE_PAGERANK_THRESHOLD", fileConfig.coreProtection?.pageRankThreshold ?? 0.3),
                incomingCountThreshold: ConfigurationManager.get("KAIRO_CORE_INCOMING_THRESHOLD", fileConfig.coreProtection?.incomingCountThreshold ?? 10),
                blockPolicy: ConfigurationManager.get("KAIRO_CORE_BLOCK_POLICY", fileConfig.coreProtection?.blockPolicy ?? "warn_only")
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
    }

    public static getOverridePolicy(): {
        enabled: boolean;
        maxTtlMinutes: number;
        maxFiles: number;
        allowed: Record<string, boolean | "confirm_only">;
    } {
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
        const fileConfig = ConfigurationManager.loadOverridesConfig();
        return {
            enabled: fileConfig.enabled ?? defaults.enabled,
            maxTtlMinutes: Number.isFinite(fileConfig.maxTtlMinutes) ? (fileConfig.maxTtlMinutes as number) : defaults.maxTtlMinutes,
            maxFiles: Number.isFinite(fileConfig.maxFiles) ? (fileConfig.maxFiles as number) : defaults.maxFiles,
            allowed: fileConfig.allowed ?? defaults.allowed
        };
    }

    private static loadArchitecturalSafetyConfig(): {
        enabled?: boolean;
        coreThreshold?: number;
        blockPolicy?: string;
        maxDepth?: number;
    } {
        const configPath = path.join(process.cwd(), ".mcp-config.json");
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
    }

    private static loadIntegrityGuardrailsConfig(): {
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
    } {
        const configPath = path.join(process.cwd(), ".mcp-config.json");
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
    }

    private static loadOverridesConfig(): OverridePolicyConfig {
        const configPath = path.join(process.cwd(), ".mcp-config.json");
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
    }

    private static parseValidationMode(value: string | undefined, fallback: ValidationMode): ValidationMode {
        if (value === "off" || value === "warn" || value === "error") {
            return value;
        }
        return fallback;
    }

    private static parseValidationTimeout(value: string | undefined, fallback: number): number {
        if (!value) return fallback;
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
        return fallback;
    }
}

