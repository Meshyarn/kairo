import chokidar from "chokidar";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import type { ValidationConfig } from "../types/validation.js";
import { PathManager } from "../utils/PathManager.js";
import {
    getAllowAmbiguousAutoPick as resolveAllowAmbiguousAutoPick,
    getArchitecturalSafetyConfig as resolveArchitecturalSafetyConfig,
    getEditorV2Enabled as resolveEditorV2Enabled,
    getEditorV2Mode as resolveEditorV2Mode,
    getEnvValue as resolveEnvValue,
    getIntegrityGuardrailsConfig as resolveIntegrityGuardrailsConfig,
    getLayer3CodeGenEnabled as resolveLayer3CodeGenEnabled,
    getLayer3GenSimilarCount as resolveLayer3GenSimilarCount,
    getLayer3ImpactMaxDepth as resolveLayer3ImpactMaxDepth,
    getLayer3SmartMatchEnabled as resolveLayer3SmartMatchEnabled,
    getLayer3SmartMatchThreshold as resolveLayer3SmartMatchThreshold,
    getLayer3SymbolImpactEnabled as resolveLayer3SymbolImpactEnabled,
    getMaxLevenshteinFileBytes as resolveMaxLevenshteinFileBytes,
    getMinLevenshteinTargetLen as resolveMinLevenshteinTargetLen,
    getOverridePolicy as resolveOverridePolicy,
    getResolveTimeoutMs as resolveResolveTimeoutMs,
    getValidationConfig as resolveValidationConfig
} from "./ConfigurationManagerConfig.js";
import type { OverridePolicyConfig } from "./ConfigurationManagerTypes.js";
export type { OverridePolicyConfig } from "./ConfigurationManagerTypes.js";

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

const WATCH_FILES = [
    "tsconfig.json",
    "jsconfig.json",
    "package.json"
];
const IGNORE_FILES = [".gitignore", ".mcpignore"];
const IGNORE_SCAN_EXCLUDES_BASE = new Set([
    ".git",
    "node_modules",
    ".mcp",
    ".kairo",
    ".kairo-index",
    "dist",
    "coverage"
]);

const getIgnoreScanExcludes = (): Set<string> => {
    const excludes = new Set(IGNORE_SCAN_EXCLUDES_BASE);
    const baseDir = PathManager.getBaseDir()
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .replace(/^\.\//, "");
    if (baseDir && !path.isAbsolute(baseDir)) {
        const root = baseDir.split("/")[0];
        if (root) excludes.add(root);
    }
    return excludes;
};

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
        const ignoreScanExcludes = getIgnoreScanExcludes();
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
                    if (ignoreScanExcludes.has(entry.name)) {
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
        return resolveEnvValue(key, defaultValue);
    }

    public static getEditorV2Enabled(): boolean {
        return resolveEditorV2Enabled();
    }

    public static getEditorV2Mode(): "off" | "dryrun" | "apply" {
        return resolveEditorV2Mode();
    }

    public static getResolveTimeoutMs(): number {
        return resolveResolveTimeoutMs();
    }

    public static getMinLevenshteinTargetLen(): number {
        return resolveMinLevenshteinTargetLen();
    }

    public static getMaxLevenshteinFileBytes(): number {
        return resolveMaxLevenshteinFileBytes();
    }

    public static getAllowAmbiguousAutoPick(): boolean {
        return resolveAllowAmbiguousAutoPick();
    }

    public static getLayer3SmartMatchEnabled(): boolean {
        return resolveLayer3SmartMatchEnabled();
    }

    public static getLayer3SmartMatchThreshold(): number {
        return resolveLayer3SmartMatchThreshold();
    }

    public static getLayer3SymbolImpactEnabled(): boolean {
        return resolveLayer3SymbolImpactEnabled();
    }

    public static getLayer3ImpactMaxDepth(): number {
        return resolveLayer3ImpactMaxDepth();
    }

    public static getLayer3CodeGenEnabled(): boolean {
        return resolveLayer3CodeGenEnabled();
    }

    public static getLayer3GenSimilarCount(): number {
        return resolveLayer3GenSimilarCount();
    }

    public static getValidationConfig(): ValidationConfig {
        return resolveValidationConfig();
    }

    public static getArchitecturalSafetyConfig(): {
        enabled: boolean;
        coreThreshold: number;
        blockPolicy: string;
        maxDepth: number;
    } {
        return resolveArchitecturalSafetyConfig();
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
        return resolveIntegrityGuardrailsConfig();
    }

    public static getOverridePolicy(): {
        enabled: boolean;
        maxTtlMinutes: number;
        maxFiles: number;
        allowed: Record<string, boolean | "confirm_only">;
    } {
        return resolveOverridePolicy();
    }
}

