import * as fs from "fs";
import { PathManager } from "../utils/PathManager.js";

export type GraphRagSeedPolicyName = "path_first" | "symbol_semantic" | "lexical_default" | "doc_first";
export type GraphRagSeedSource = "semantic" | "lexical" | "path" | "doc";

export interface GraphRagSeedWeights {
    path?: number;
    lexical?: number;
    semantic?: number;
    doc?: number;
}

export interface GraphRagSeedPolicyDefinition {
    weights: GraphRagSeedWeights;
}

export interface GraphRagSeedPolicyConfig {
    default: GraphRagSeedPolicyName;
    policies: Record<GraphRagSeedPolicyName, GraphRagSeedPolicyDefinition>;
}

export interface GraphRagTuningConfig {
    primaryGoal: "followup_calls" | "token_usage";
    secondaryGoal: "followup_calls" | "token_usage";
}

export interface GraphRagCrossBoundaryCaps {
    maxDepth: number;
    maxFiles: number;
    maxSymbols: number;
    maxTokens: number;
}

export interface GraphRagCrossBoundaryScaleCaps {
    s: GraphRagCrossBoundaryCaps;
    m: GraphRagCrossBoundaryCaps;
    l: GraphRagCrossBoundaryCaps;
}

export interface GraphRagCrossBoundaryConfig {
    allowlist: string[];
    caps: GraphRagCrossBoundaryCaps;
    scaleCaps: GraphRagCrossBoundaryScaleCaps;
    autoScale: boolean;
}

export interface GraphRagConfig {
    version: number;
    enabled: boolean;
    seedPolicy: GraphRagSeedPolicyConfig;
    tuning: GraphRagTuningConfig;
    crossBoundary: GraphRagCrossBoundaryConfig;
}

export type GraphRagScaleTier = "S" | "M" | "L";

export const DEFAULT_GRAPHRAG_CONFIG: GraphRagConfig = {
    version: 1,
    enabled: false,
    seedPolicy: {
        default: "lexical_default",
        policies: {
            path_first: { weights: { path: 1.0, lexical: 0.6, semantic: 0.2 } },
            symbol_semantic: { weights: { semantic: 1.0, lexical: 0.5, path: 0.2 } },
            lexical_default: { weights: { lexical: 1.0, semantic: 0.3, path: 0.3 } },
            doc_first: { weights: { doc: 1.0, lexical: 0.4, semantic: 0.2, path: 0.2 } }
        }
    },
    tuning: {
        primaryGoal: "followup_calls",
        secondaryGoal: "token_usage"
    },
    crossBoundary: {
        allowlist: ["ffi_napi", "idl_proto", "http_openapi", "db_sql_schema"],
        caps: {
            maxDepth: 1,
            maxFiles: 8,
            maxSymbols: 20,
            maxTokens: 800
        },
        scaleCaps: {
            s: { maxDepth: 1, maxFiles: 12, maxSymbols: 40, maxTokens: 1200 },
            m: { maxDepth: 1, maxFiles: 8, maxSymbols: 20, maxTokens: 800 },
            l: { maxDepth: 1, maxFiles: 4, maxSymbols: 10, maxTokens: 400 }
        },
        autoScale: true
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

export const resolveGraphRagEnabled = (config: GraphRagConfig): boolean => {
    const envOverride = parseBooleanEnv(process.env.KAIRO_GRAPHRAG_ENABLED);
    if (typeof envOverride === "boolean") return envOverride;
    return config.enabled;
};

export const resolveScaleTier = (fileCount?: number): GraphRagScaleTier | undefined => {
    if (typeof fileCount !== "number" || !Number.isFinite(fileCount)) return undefined;
    const sMax = parseNumberEnv(process.env.KAIRO_SCALE_TIER_S_MAX_FILES, 5000);
    const mMax = parseNumberEnv(process.env.KAIRO_SCALE_TIER_M_MAX_FILES, 50000);
    if (fileCount <= sMax) return "S";
    if (fileCount <= mMax) return "M";
    return "L";
};

export const resolveCrossBoundaryCaps = (
    config: GraphRagConfig,
    fileCount?: number
): GraphRagCrossBoundaryCaps => {
    const base = config.crossBoundary.caps;
    if (!config.crossBoundary.autoScale) {
        return base;
    }
    const tier = resolveScaleTier(fileCount);
    if (!tier) return base;
    const scaleCaps = config.crossBoundary.scaleCaps;
    const scaled = tier === "S" ? scaleCaps.s : (tier === "M" ? scaleCaps.m : scaleCaps.l);
    return {
        ...base,
        ...scaled
    };
};

export class GraphRagConfigLoader {
    private config: GraphRagConfig;
    private watcher?: fs.FSWatcher;
    private readonly configPath: string;

    constructor(private readonly rootPath: string) {
        this.configPath = this.resolveConfigPath();
        this.config = this.loadConfig();
    }

    public getConfig(): GraphRagConfig {
        return {
            ...this.config,
            enabled: resolveGraphRagEnabled(this.config)
        };
    }

    public reload(): void {
        this.config = this.loadConfig();
    }

    public watch(onChange: () => void): void {
        if (this.watcher) return;
        if (fs.existsSync(this.configPath)) {
            this.watcher = fs.watch(this.configPath, { persistent: false }, (event) => {
                if (event === "change" || event === "rename") {
                    this.reload();
                    onChange();
                }
            });
        }
    }

    public dispose(): void {
        this.watcher?.close();
    }

    private resolveConfigPath(): string {
        const primary = PathManager.resolveForRoot(this.rootPath, "config", "graphrag.json");
        if (fs.existsSync(primary)) {
            return primary;
        }

        const legacy = PathManager.resolveForRoot(this.rootPath, "graphrag.json");
        if (fs.existsSync(legacy)) {
            return legacy;
        }

        return primary;
    }

    private loadConfig(): GraphRagConfig {
        let userConfig: Partial<GraphRagConfig> | undefined;
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, "utf-8");
                userConfig = JSON.parse(raw);
            }
        } catch (error) {
            console.warn(`[GraphRagConfig] Failed to parse ${this.configPath}:`, error);
        }

        const seedPolicy = userConfig?.seedPolicy ?? {};
        const crossBoundary = userConfig?.crossBoundary ?? {};

        return {
            ...DEFAULT_GRAPHRAG_CONFIG,
            ...userConfig,
            seedPolicy: {
                ...DEFAULT_GRAPHRAG_CONFIG.seedPolicy,
                ...seedPolicy,
                policies: {
                    ...DEFAULT_GRAPHRAG_CONFIG.seedPolicy.policies,
                    ...(seedPolicy as GraphRagSeedPolicyConfig).policies
                }
            },
            tuning: {
                ...DEFAULT_GRAPHRAG_CONFIG.tuning,
                ...(userConfig?.tuning ?? {})
            },
            crossBoundary: {
                ...DEFAULT_GRAPHRAG_CONFIG.crossBoundary,
                ...crossBoundary,
                caps: {
                    ...DEFAULT_GRAPHRAG_CONFIG.crossBoundary.caps,
                    ...(crossBoundary as GraphRagCrossBoundaryConfig).caps
                },
                scaleCaps: {
                    s: {
                        ...DEFAULT_GRAPHRAG_CONFIG.crossBoundary.scaleCaps.s,
                        ...(crossBoundary as GraphRagCrossBoundaryConfig).scaleCaps?.s
                    },
                    m: {
                        ...DEFAULT_GRAPHRAG_CONFIG.crossBoundary.scaleCaps.m,
                        ...(crossBoundary as GraphRagCrossBoundaryConfig).scaleCaps?.m
                    },
                    l: {
                        ...DEFAULT_GRAPHRAG_CONFIG.crossBoundary.scaleCaps.l,
                        ...(crossBoundary as GraphRagCrossBoundaryConfig).scaleCaps?.l
                    }
                }
            }
        };
    }
}
