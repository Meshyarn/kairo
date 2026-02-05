import * as path from "path";
import { createHash } from "crypto";
import { performance } from "node:perf_hooks";
import { metrics } from "../../utils/MetricsCollector.js";
import { resolveRolloutPresetFromEnv, computeAdaptiveFlowGate } from "../../orchestration/adaptive-flow/AdaptiveFlowGate.js";
import { FeatureFlags } from "../../config/FeatureFlags.js";
import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";
import { PathManager } from "../../utils/PathManager.js";
import { isHashModel } from "../../embeddings/EmbeddingDiagnostics.js";
import type { HandlerContext } from "../HandlerContext.js";
import { parseNumberEnv } from "./ManageStatusEnv.js";
import { buildWorkspaceDrift } from "./ManageStatusDrift.js";

export { parseNumberEnv };

export const resolveSymbolSemanticSearchFlags = (): { enabled: boolean; mode: "off" | "manual" } => {
    const enabled = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_ENABLED ?? "false").toLowerCase() === "true";
    const modeRaw = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_MODE ?? "manual").toLowerCase();
    const mode = modeRaw === "off" ? "off" : "manual";
    return { enabled: enabled && mode !== "off", mode };
};

export const buildSymbolIndexStatus = (context: HandlerContext) => {
    const config = resolveSymbolSemanticSearchFlags();
    const degraded: string[] = [];
    if (!config.enabled) {
        degraded.push("symbol_semantic_search_disabled");
    }
    if (config.enabled && !context.symbolEmbeddingIndex) {
        degraded.push("embedding_provider_disabled");
    }
    const status = context.symbolEmbeddingIndex?.getStatus();
    if (config.enabled && status && !status.lastBuildAt) {
        degraded.push("symbol_embeddings_not_built");
    }
    return {
        enabled: config.enabled,
        mode: config.mode,
        ...(status ?? {}),
        degradedReasons: buildDegradedReasons(degraded)
    };
};

export const buildProcessStats = (): any => {
    try {
        const mem = process.memoryUsage();
        const cpu = process.cpuUsage();
        const resource = typeof (process as any).resourceUsage === "function"
            ? (process as any).resourceUsage()
            : undefined;
        const elu = typeof (performance as any).eventLoopUtilization === "function"
            ? (performance as any).eventLoopUtilization()
            : undefined;
        return {
            pid: process.pid,
            uptimeSec: process.uptime(),
            memoryBytes: {
                rss: mem.rss,
                heapUsed: mem.heapUsed,
                heapTotal: mem.heapTotal,
                external: mem.external,
                arrayBuffers: mem.arrayBuffers
            },
            cpuMicros: {
                user: cpu.user,
                system: cpu.system
            },
            ...(resource ? { resourceUsage: resource } : {}),
            ...(elu ? { eventLoopUtilization: elu } : {})
        };
    } catch {
        return undefined;
    }
};

export const buildNativeSearchStatus = (context: HandlerContext) => {
    const degraded: string[] = [];
    const status = context.searchEngine.getNativeStatus();
    if (!status.available) {
        degraded.push("native_search_unavailable");
    }
    if (status.available && status.stats && status.stats.writeEnabled === false) {
        degraded.push("index_write_locked");
    }
    return {
        ...status,
        degradedReasons: buildDegradedReasons(degraded)
    };
};

const resolveScaleTier = (fileCount?: number): "S" | "M" | "L" | undefined => {
    if (typeof fileCount !== "number" || !Number.isFinite(fileCount)) return undefined;
    const sMax = parseNumberEnv(process.env.KAIRO_SCALE_TIER_S_MAX_FILES, 5000);
    const mMax = parseNumberEnv(process.env.KAIRO_SCALE_TIER_M_MAX_FILES, 50000);
    if (fileCount < sMax) return "S";
    if (fileCount < mMax) return "M";
    return "L";
};

export const buildCostSummary = (fileCount?: number, snapshot?: ReturnType<typeof metrics.snapshot>) => {
    const metricsSnapshot = snapshot ?? metrics.snapshot();
    const getHist = (name: string) => metricsSnapshot.histograms[name];
    const scaleTier = resolveScaleTier(fileCount);
    return {
        histograms: {
            explore: getHist("explore.total_ms"),
            understand: getHist("understand.total_ms"),
            change: getHist("change.total_ms"),
            write: getHist("write.total_ms")
        },
        ...(scaleTier ? { scaleTier } : {})
    };
};

export const buildTelemetrySummary = (snapshot: ReturnType<typeof metrics.snapshot>) => {
    const counters = snapshot.counters ?? {};
    const histograms = snapshot.histograms ?? {};
    const roundRatio = (value: number) => Math.round(value * 1000) / 1000;
    const collectEntries = (prefix: string, label: string) => Object.entries(counters)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, count]) => ({
            [label]: key.slice(prefix.length),
            count
        }));
    const buildTop = (entries: Array<Record<string, any>>, limit: number) => entries
        .sort((a, b) => (b.count as number) - (a.count as number))
        .slice(0, limit);

    const toolPrefix = "tool.calls.";
    const toolEntries = Object.entries(counters)
        .filter(([key]) => key.startsWith(toolPrefix) && key !== "tool.calls_total")
        .map(([key, count]) => ({ tool: key.slice(toolPrefix.length), count }))
        .sort((a, b) => b.count - a.count);
    const toolTotal = counters["tool.calls_total"] ?? toolEntries.reduce((sum, entry) => sum + entry.count, 0);
    const toolTop = toolEntries.slice(0, 5).map((entry) => ({
        tool: entry.tool,
        count: entry.count,
        ...(toolTotal > 0 ? { ratio: roundRatio(entry.count / toolTotal) } : {})
    }));

    const timeoutEntriesAll = collectEntries("timeout.", "location");
    const timeoutTotal = timeoutEntriesAll.reduce((sum, entry) => sum + (entry.count as number), 0);
    const timeoutEntries = buildTop(timeoutEntriesAll, 5);

    const degradedEntriesAll = collectEntries("degraded.reason.", "type");
    const degradedTotal = degradedEntriesAll.reduce((sum, entry) => sum + (entry.count as number), 0);
    const degradedEntries = buildTop(degradedEntriesAll, 5);

    const planTotal = counters["change.plan_total"] ?? 0;
    const applyTotal = counters["change.apply_total"] ?? 0;

    return {
        tools: {
            total: toolTotal,
            top: toolTop
        },
        timeouts: {
            total: timeoutTotal,
            top: timeoutEntries
        },
        degradedReasons: {
            total: degradedTotal,
            top: degradedEntries
        },
        responseEnvelope: {
            tokens: histograms["response.envelope.tokens"],
            chars: histograms["response.envelope.chars"]
        },
        changeConversion: {
            plan: planTotal,
            apply: applyTotal,
            ...(planTotal > 0 ? { rate: roundRatio(applyTotal / planTotal) } : {})
        }
    };
};

export const buildRolloutStatus = (context: HandlerContext, fileCount?: number) => {
    const preset = resolveRolloutPresetFromEnv() ?? "full";
    const userId = FeatureFlags.getContext()?.userId;
    const userIdResolved = Boolean(userId);
    const userIdHash = userId
        ? createHash("sha1").update(userId).digest("hex").slice(0, 8)
        : undefined;
    const manualOverrides = [
        "KAIRO_ADAPTIVE_FLOW_ENABLED",
        "KAIRO_TOPOLOGY_SCANNER_ENABLED",
        "KAIRO_UCG_ENABLED"
    ].filter((key) => Boolean(process.env[key]));
    const flags = {
        adaptiveFlow: FeatureFlags.isEnabled(FeatureFlags.ADAPTIVE_FLOW_ENABLED),
        ucg: FeatureFlags.isEnabled(FeatureFlags.UCG_ENABLED),
        topologyScanner: FeatureFlags.isEnabled(FeatureFlags.TOPOLOGY_SCANNER_ENABLED),
        dualWrite: FeatureFlags.isEnabled(FeatureFlags.DUAL_WRITE_VALIDATION)
    };
    const modes = {
        adaptiveFlow: FeatureFlags.getMode(FeatureFlags.ADAPTIVE_FLOW_ENABLED),
        ucg: FeatureFlags.getMode(FeatureFlags.UCG_ENABLED),
        topologyScanner: FeatureFlags.getMode(FeatureFlags.TOPOLOGY_SCANNER_ENABLED),
        dualWrite: FeatureFlags.getMode(FeatureFlags.DUAL_WRITE_VALIDATION)
    };
    const profile = "balanced";
    const gate = computeAdaptiveFlowGate({ profile, fileCount });
    const reasonCodes: string[] = [];
    if (gate.gatedByProfile) reasonCodes.push("profile_gate");
    if (gate.gatedByScale) reasonCodes.push("scale_gate");
    return {
        preset,
        userIdResolved,
        ...(userIdHash ? { userIdHash } : {}),
        cohort: {
            canaryUserCount: FeatureFlags.getCanaryUserCount(),
            betaPercent: FeatureFlags.getBetaPercent()
        },
        overrides: {
            forcePreset: process.env.KAIRO_ROLLOUT_FORCE === "true",
            manualEnvOverrides: manualOverrides
        },
        flags,
        modes,
        adaptiveFlow: {
            enabled: flags.adaptiveFlow,
            profile,
            fileCount,
            appliedMinLOD: gate.allowedMaxLOD,
            gatedByProfile: gate.gatedByProfile,
            gatedByScale: gate.gatedByScale,
            reasonCodes,
            metrics: {
                enabled: process.env.KAIRO_METRICS_ENABLED !== "false",
                dir: process.env.KAIRO_METRICS_DIR ?? PathManager.getMetricsDir(),
                intervalMs: Number(process.env.KAIRO_METRICS_INTERVAL_MS ?? 60_000)
            },
            alertThresholds: {
                topologySuccessRate: parseNumberEnv(process.env.KAIRO_TOPOLOGY_SUCCESS_MIN, 0.95),
                ucgMemoryMb: parseNumberEnv(process.env.KAIRO_UCG_MEMORY_MAX_MB, 500),
                l3PromotionRatio: parseNumberEnv(process.env.KAIRO_L3_PROMOTION_RATIO_MAX, 0.5)
            }
        }
    };
};

export { buildWorkspaceDrift };

export const buildCapabilityHints = (
    snapshot: ReturnType<typeof import("../../orchestration/capabilities/EngineManager.js").EngineManager.getDiagnosticsSnapshot>,
    options?: { detail?: "summary" | "full" }
): string[] => {
    const hints: string[] = [];
    const actionHints: Record<string, string> = {
        CAP_CHUNKING_TOKENS: "Enable Rust chunking (KAIRO_RUST_CORE_ENABLED/KAIRO_RUST_CHUNKING_ENABLED) or WASM chunking (KAIRO_WASM_CHUNKING_ENABLED).",
        CAP_DIFF_UNIFIED: "Enable Rust diffing (KAIRO_RUST_CORE_ENABLED/KAIRO_RUST_DIFF_ENABLED) or rely on JS diffing (default).",
        CAP_SYMBOLIC_SOLVE: "Enable Rust symbolic solver (KAIRO_RUST_CORE_ENABLED/KAIRO_RUST_SYMBOLIC_SOLVER_ENABLED).",
        CAP_SYNTAX_VALIDATE: "Enable Rust syntax (KAIRO_RUST_CORE_ENABLED/KAIRO_RUST_SYNTAX_ENABLED) or ensure tree-sitter WASM assets are available.",
        CAP_VECTOR_COSINE_BATCH: "Enable Rust vector math (KAIRO_RUST_CORE_ENABLED/KAIRO_RUST_VECTOR_ENABLED) or rely on JS vector math (default).",
        CAP_TEXT_STATS: "Ensure JsTextStatsProvider is registered (default)."
    };
    if (!snapshot.rustCore.available && snapshot.rustCore.error) {
        hints.push(`Rust core unavailable: ${snapshot.rustCore.error}`);
    }
    const tokenizer = snapshot.tokenizer;
    if (tokenizer?.missingReason) {
        hints.push(tokenizer.missingReason);
    }
    if (snapshot.coverage?.missing?.length) {
        for (const capabilityId of snapshot.coverage.missing) {
            const action = actionHints[capabilityId];
            hints.push(
                action
                    ? `Capability ${capabilityId} has no registered providers. ${action}`
                    : `Capability ${capabilityId} has no registered providers.`
            );
        }
    }
    if (options?.detail === "full") {
        for (const status of Object.values(snapshot.capabilities ?? {})) {
            if (!status.candidates || status.candidates.length === 0) continue;
            const available = status.candidates.some(candidate => candidate.available);
            if (available) continue;
            const reasons = status.candidates
                .map(candidate => candidate.reason)
                .filter((reason): reason is string => typeof reason === "string" && reason.length > 0);
            const reasonText = reasons.length > 0 ? ` Reasons: ${Array.from(new Set(reasons)).join("; ")}.` : "";
            const action = actionHints[status.capabilityId];
            hints.push(
                action
                    ? `Capability ${status.capabilityId} has no available providers.${reasonText} ${action}`
                    : `Capability ${status.capabilityId} has no available providers.${reasonText}`
            );
        }
    }
    return Array.from(new Set(hints));
};

export const buildStaleRiskGuidance = (level: "low" | "medium" | "high") => {
    if (level === "low") return null;
    const message = level === "high"
        ? "Index staleness is high; reindex is recommended before apply."
        : "Index staleness is elevated; consider reindexing for reliable results.";
    return {
        level,
        message,
        suggestedActions: [
            {
                id: "manage.reindex",
                description: "Rebuild index to reduce stale risk.",
                toolCall: { tool: "manage", args: { command: "reindex" } }
            }
        ]
    };
};

export const buildEmbeddingFindings = (diagnostics: ReturnType<typeof import("../../embeddings/EmbeddingDiagnostics.js").computeEmbeddingDiagnostics>): Array<{ code: string; severity: "info" | "warning" | "critical"; message: string }> => {
    const findings: Array<{ code: string; severity: "info" | "warning" | "critical"; message: string }> = [];
    if (diagnostics.remoteDownloadsAllowed) {
        findings.push({
            code: "EMBEDDINGS_REMOTE_ENABLED",
            severity: "warning",
            message: "Remote embeddings downloads are enabled; offline baseline is not guaranteed (level=none)."
        });
    }
    if (!diagnostics.remoteDownloadsAllowed && diagnostics.offlineBaselineLevel === "A-core") {
        findings.push({
            code: "EMBEDDINGS_OFFLINE_BASELINE_CORE",
            severity: "info",
            message: "Offline baseline is core-only; add a local model to reach embeddings-ready (see docs/guides/getting-started.md)."
        });
    }
    const modelId = diagnostics.modelId;
    if (modelId && !isHashModel(modelId) && diagnostics.missingAssets && diagnostics.missingAssets.length > 0) {
        findings.push({
            code: diagnostics.resolvedModelRoot ? "EMBEDDINGS_LOCAL_MODEL_INCOMPLETE" : "EMBEDDINGS_LOCAL_MODEL_MISSING",
            severity: "warning",
            message: diagnostics.resolvedModelRoot
                ? "Local embedding model is incomplete; required files are missing."
                : "Local embedding model is missing; embeddings-ready baseline is not met."
        });
    }
    return findings;
};

export const recordIndexMetrics = (snapshot: { epoch: number; dirtyFileCount: number; coverageRatio: number; staleRisk: "low" | "medium" | "high" }): void => {
    metrics.gauge("index.epoch", snapshot.epoch);
    metrics.gauge("index.dirty_files", snapshot.dirtyFileCount);
    metrics.gauge("index.coverage_ratio", snapshot.coverageRatio);
    const riskLevel = snapshot.staleRisk === "high" ? 2 : snapshot.staleRisk === "medium" ? 1 : 0;
    metrics.gauge("index.stale_risk_level", riskLevel);
    metrics.inc("cache.invalidate.file_total", 0);
    metrics.inc("cache.invalidate.dir_total", 0);
    metrics.inc("cache.invalidate.all_total", 0);
};

const getDirectorySizeBytes = async (context: HandlerContext, dirPath: string): Promise<number> => {
    let total = 0;
    const stack: string[] = [dirPath];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: string[] = [];
        try {
            entries = await context.fileSystem.readDir(current);
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry);
            try {
                const stat = await context.fileSystem.stat(fullPath);
                if (stat.isDirectory()) {
                    stack.push(fullPath);
                } else {
                    total += stat.size;
                }
            } catch {
                continue;
            }
        }
    }
    return total;
};

export const buildBudgetSnapshot = async (context: HandlerContext): Promise<{
    indexDirBytes: number;
    storageDirBytes: number;
    symbolSecondaryIndexEnabled: boolean;
    symbolSecondaryIndexBytes?: number;
} | null> => {
    try {
        const indexDir = PathManager.getIndexDir();
        const storageDir = PathManager.getStorageDir();
        const indexDirBytes = await getDirectorySizeBytes(context, indexDir);
        const storageDirBytes = await getDirectorySizeBytes(context, storageDir);
        const secondaryStatus = context.indexDatabase?.getSecondaryIndexStatus?.();
        return {
            indexDirBytes,
            storageDirBytes,
            symbolSecondaryIndexEnabled: secondaryStatus?.enabled ?? false,
            ...(secondaryStatus?.bytes !== undefined ? { symbolSecondaryIndexBytes: secondaryStatus.bytes } : {})
        };
    } catch {
        return null;
    }
};

export const recordBudgetMetrics = (snapshot: {
    indexDirBytes: number;
    storageDirBytes: number;
    symbolSecondaryIndexEnabled: boolean;
    symbolSecondaryIndexBytes?: number;
}): void => {
    metrics.gauge("budget.index_dir_bytes", snapshot.indexDirBytes);
    metrics.gauge("budget.storage_dir_bytes", snapshot.storageDirBytes);
    if (snapshot.symbolSecondaryIndexBytes !== undefined) {
        metrics.gauge("budget.symbol_secondary_index_bytes", snapshot.symbolSecondaryIndexBytes);
    }
    metrics.gauge("symbol.search.secondary_index_enabled", snapshot.symbolSecondaryIndexEnabled ? 1 : 0);
};
