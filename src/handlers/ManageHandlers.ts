import * as path from "path";
import { createHash } from "crypto";
import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { metrics } from "../utils/MetricsCollector.js";
import { resolveEmbeddingConfigFromEnv } from "../embeddings/EmbeddingConfig.js";
import { computeEmbeddingDiagnostics, isHashModel } from "../embeddings/EmbeddingDiagnostics.js";
import { ConfigBootstrapper } from "../config/ConfigBootstrapper.js";
import { StorageMaintenanceService } from "../indexing/StorageMaintenanceService.js";
import { EngineManager } from "../orchestration/capabilities/EngineManager.js";
import { AuditLog } from "../utils/AuditLog.js";
import { ConfigurationManager } from "../config/ConfigurationManager.js";
import { buildCatalogCoverage } from "../utils/MetricsCatalog.js";
import { PathManager } from "../utils/PathManager.js";
import { FeatureFlags } from "../config/FeatureFlags.js";
import { computeAdaptiveFlowGate, resolveRolloutPresetFromEnv } from "../orchestration/adaptive-flow/AdaptiveFlowGate.js";
import { buildDegradedReasons } from "../orchestration/DegradedReasonMapper.js";
import type { TransactionLogEntry } from "../engine/TransactionLog.js";

export class ManageHandlers extends BaseHandler {
    private reindexInProgress = false;
    private reindexLastResult?: { success: boolean; output: string; startedAt: string; finishedAt?: string };

    constructor(private context: HandlerContext) {
        super(context.toolSpecRegistry);
    }

    async handle(name: string, args: any): Promise<any> {
        const pillarTools = new Set(['manage']);
        const internalTools = new Set(['project_manage']);

        if (pillarTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args);
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }
            const result = await this.context.orchestrationEngine.executePillar(name, args);
            return this.jsonResponse(result);
        }

        if (internalTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args);
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }
            return this.jsonResponse(await this.manageProjectRaw(args));
        }
        return null;
    }

    private resolveRelativePath(inputPath: string): string {
        return this.context.pathNormalizer.normalize(inputPath);
    }

    private resolveAbsolutePath(inputPath: string): string {
        return this.context.pathNormalizer.toAbsolute(this.resolveRelativePath(inputPath));
    }

    private buildRolloutStatus(fileCount?: number) {
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
                    dir: process.env.KAIRO_METRICS_DIR ?? path.join(this.context.rootPath, ".kairo", "logs"),
                    intervalMs: Number(process.env.KAIRO_METRICS_INTERVAL_MS ?? 60_000)
                },
                alertThresholds: {
                    topologySuccessRate: this.parseNumberEnv(process.env.KAIRO_TOPOLOGY_SUCCESS_MIN, 0.95),
                    ucgMemoryMb: this.parseNumberEnv(process.env.KAIRO_UCG_MEMORY_MAX_MB, 500),
                    l3PromotionRatio: this.parseNumberEnv(process.env.KAIRO_L3_PROMOTION_RATIO_MAX, 0.5)
                }
            }
        };
    }

    private async buildWorkspaceDrift(options?: { maxFiles?: number }) {
        const maxFiles = options?.maxFiles ?? this.parseNumberEnv(process.env.KAIRO_DRIFT_CHECK_MAX_FILES, 200);
        const records = this.context.indexDatabase.listFiles();
        if (!records.length) {
            return {
                workspaceDrift: "unknown",
                scopes: [],
                checkedFiles: 0,
                mismatchedFiles: 0
            };
        }
        const workspaceScopeId = `workspace:${createHash("sha1").update(this.context.rootPath).digest("hex").slice(0, 8)}`;
        type ScopeStat = {
            scopeId: string;
            root: string;
            kind: "workspaceRoot" | "repoRoot";
            repoId?: string;
            checkedFiles: number;
            mismatchedFiles: number;
            mismatchedPaths: string[];
        };
        const scopeStats = new Map<string, ScopeStat>();

        const getScope = (absPath: string) => {
            const repo = this.context.repoRegistry?.findRepoByPath?.(absPath);
            if (repo) {
                const scopeId = `repo:${repo.id}`;
                const existing = scopeStats.get(scopeId);
                if (existing) return existing;
                const created: ScopeStat = {
                    scopeId,
                    root: repo.path,
                    kind: "repoRoot" as const,
                    repoId: repo.id,
                    checkedFiles: 0,
                    mismatchedFiles: 0,
                    mismatchedPaths: []
                };
                scopeStats.set(scopeId, created);
                return created;
            }
            const existing = scopeStats.get(workspaceScopeId);
            if (existing) return existing;
            const created: ScopeStat = {
                scopeId: workspaceScopeId,
                root: this.context.rootPath,
                kind: "workspaceRoot" as const,
                checkedFiles: 0,
                mismatchedFiles: 0,
                mismatchedPaths: []
            };
            scopeStats.set(workspaceScopeId, created);
            return created;
        };

        let checked = 0;
        let mismatched = 0;
        for (const record of records) {
            if (checked >= maxFiles) break;
            const absPath = this.resolveAbsolutePath(record.path);
            const scope = getScope(absPath);
            let isMismatched = false;
            try {
                const stat = await this.context.fileSystem.stat(absPath);
                if (stat.mtime > (record.last_modified ?? 0)) {
                    isMismatched = true;
                }
            } catch {
                isMismatched = true;
            }
            scope.checkedFiles += 1;
            checked += 1;
            if (isMismatched) {
                scope.mismatchedFiles += 1;
                mismatched += 1;
                if (scope.mismatchedPaths.length < 20) {
                    scope.mismatchedPaths.push(record.path);
                }
            }
        }

        metrics.gauge("drift.checked_files", checked);
        metrics.gauge("drift.mismatched_files", mismatched);
        metrics.inc(mismatched > 0 ? "drift.detected" : "drift.clean");

        const scopes = Array.from(scopeStats.values()).map(entry => {
            const drift = entry.checkedFiles === 0 ? "unknown" : (entry.mismatchedFiles > 0 ? "detected" : "clean");
            return {
                scopeId: entry.scopeId,
                root: entry.root,
                kind: entry.kind,
                ...(entry.repoId ? { repoId: entry.repoId } : {}),
                drift,
                signals: entry.mismatchedFiles > 0 ? ["mtime_changed"] : [],
                affectedPathsCount: entry.mismatchedFiles,
                indexStaleRatio: entry.checkedFiles > 0 ? entry.mismatchedFiles / entry.checkedFiles : undefined,
                ...(entry.mismatchedPaths.length > 0 ? { samplePaths: entry.mismatchedPaths } : {}),
                scopeConfidence: entry.checkedFiles > 0 ? "low" : "unknown"
            };
        }).sort((a, b) => (b.affectedPathsCount ?? 0) - (a.affectedPathsCount ?? 0));

        const workspaceDrift = checked === 0 ? "unknown" : (mismatched > 0 ? "detected" : "clean");
        const targetPaths = scopes.flatMap(scope => (scope as any).samplePaths ?? []).slice(0, 50);
        const repairActions = mismatched > 0
            ? [
                ...(targetPaths.length > 0
                    ? [{
                        tool: "manage",
                        args: { command: "reindex", paths: targetPaths },
                        tags: ["repair_ladder", "attempt_2"]
                    }]
                    : []),
                {
                    tool: "manage",
                    args: { command: "reindex" },
                    tags: ["repair_ladder", "attempt_3"]
                }
            ]
            : [];
        return {
            workspaceDrift,
            scopes,
            checkedFiles: checked,
            mismatchedFiles: mismatched,
            ...(records.length > checked ? { sampled: true, totalFiles: records.length } : {}),
            ...(repairActions.length > 0 ? { repairActions } : {})
        };
    }

    private resolveSymbolSemanticSearchFlags(): { enabled: boolean; mode: "off" | "manual" } {
        const enabled = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_ENABLED ?? "false").toLowerCase() === "true";
        const modeRaw = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_MODE ?? "manual").toLowerCase();
        const mode = modeRaw === "off" ? "off" : "manual";
        return { enabled: enabled && mode !== "off", mode };
    }

    private buildSymbolIndexStatus() {
        const config = this.resolveSymbolSemanticSearchFlags();
        const degraded: string[] = [];
        if (!config.enabled) {
            degraded.push("symbol_semantic_search_disabled");
        }
        if (config.enabled && !this.context.symbolEmbeddingIndex) {
            degraded.push("embedding_provider_disabled");
        }
        const status = this.context.symbolEmbeddingIndex?.getStatus();
        if (config.enabled && status && !status.lastBuildAt) {
            degraded.push("symbol_embeddings_not_built");
        }
        return {
            enabled: config.enabled,
            mode: config.mode,
            ...(status ?? {}),
            degradedReasons: buildDegradedReasons(degraded)
        };
    }

    private parseNumberEnv(raw: string | undefined, fallback: number): number {
        if (!raw) return fallback;
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    }

    private summarizeCheckpoints(entries: TransactionLogEntry[]): Array<{
        id: string;
        timestamp: string;
        status: string;
        description: string;
        diffSummary?: TransactionLogEntry["diffSummary"];
        filesTouched?: TransactionLogEntry["filesTouched"];
    }> {
        return entries.map(entry => ({
            id: entry.id,
            timestamp: new Date(entry.timestamp).toISOString(),
            status: entry.status,
            description: entry.description,
            diffSummary: entry.diffSummary,
            filesTouched: entry.filesTouched
        }));
    }

    private async manageProjectRaw(args: any) {
        const command = args?.command;
        const scope = args?.scope;
        switch (command) {
            case 'undo':
                {
                    const result = await this.context.editCoordinator.undo();
                    return { success: result.success, output: result.message ?? "Undo complete.", result };
                }
            case 'redo':
                {
                    const result = await this.context.editCoordinator.redo();
                    return { success: result.success, output: result.message ?? "Redo complete.", result };
                }
            case 'audit':
                {
                    const action = args?.action ?? "tail";
                    const limit = typeof args?.limit === "number" ? args.limit : 100;
                    const since = typeof args?.since === "string" ? args.since : undefined;
                    const filter = args?.filter && typeof args.filter === "object" ? args.filter : undefined;
                    if (action === "stats") {
                        const stats = await AuditLog.stats();
                        return { success: true, action, stats };
                    }
                    if (action === "query") {
                        const events = await AuditLog.query({ since, filter, limit });
                        return { success: true, action, events };
                    }
                    const events = await AuditLog.tail(limit);
                    return { success: true, action: "tail", events };
                }
            case 'status':
                {
                    const suppressLogs = Boolean(args?.suppressLogs ?? args?.quiet);
                    if (suppressLogs) {
                        this.context.dependencyGraph.setLoggingEnabled(false);
                    }
                    try {
                        await this.context.dependencyGraph.ensureBuilt();
                        const status = await this.context.dependencyGraph.getIndexStatus();
                        const detail = args?.detail ?? args?.verbosity ?? 'summary';
                        const includePerFile = detail === 'full' || detail === 'verbose' || args?.includePerFile === true;
                        const lastRebuiltAt = status?.global?.lastRebuiltAt
                            ? Date.parse(status.global.lastRebuiltAt)
                            : undefined;
                        this.context.indexStateManager.updateTotals(
                            status?.global?.totalFiles ?? 0,
                            status?.global?.indexedFiles ?? status?.global?.totalFiles ?? 0,
                            Number.isFinite(lastRebuiltAt) ? lastRebuiltAt : undefined
                        );
                        const indexSnapshot = await this.context.indexStateManager.getSnapshot();
                        const indexActivity = this.context.indexStateManager.getActivity();
                        const embeddingStatus = await this.context.documentSearchEngine.getEmbeddingStatus();
                        const embeddingDiagnostics = computeEmbeddingDiagnostics();
                        const embeddingFindings = this.buildEmbeddingFindings(embeddingDiagnostics);
                        const capabilityDiagnostics = EngineManager.getDiagnosticsSnapshot({
                            detail: detail === "full" ? "full" : "summary",
                            rootPath: this.context.rootPath
                        });
                        const rolloutStatus = this.buildRolloutStatus(status?.global?.totalFiles);
                        const symbolIndexStatus = this.buildSymbolIndexStatus();
                        const driftStatus = await this.buildWorkspaceDrift();

                        if (includePerFile) {
                            return {
                                success: true,
                                output: "Index status",
                                status,
                                embedding: embeddingStatus,
                                embeddingDiagnostics,
                                embeddingFindings,
                                capabilityDiagnostics,
                                indexSnapshot,
                                symbolIndex: symbolIndexStatus,
                                drift: driftStatus,
                                rollout: rolloutStatus,
                                activity: {
                                    reindexInProgress: this.reindexInProgress,
                                    lastReindex: this.reindexLastResult,
                                    indexingActivity: indexActivity
                                }
                            };
                        }
                        const limit = typeof args?.limit === 'number' ? args.limit : 20;
                        const unresolvedSample = Object.entries(status.perFile ?? {})
                            .filter(([, value]) => !(value as any)?.resolved)
                            .slice(0, limit)
                            .map(([filePath, value]) => ({
                                filePath,
                                unresolvedImports: (value as any)?.unresolvedImports ?? []
                            }));
                        return {
                            success: true,
                            output: "Index status",
                            status: {
                                global: status.global,
                                unresolvedSample
                            },
                            embedding: embeddingStatus,
                            embeddingDiagnostics,
                            embeddingFindings,
                            capabilityDiagnostics,
                            indexSnapshot,
                            symbolIndex: symbolIndexStatus,
                            drift: driftStatus,
                            rollout: rolloutStatus,
                            activity: {
                                reindexInProgress: this.reindexInProgress,
                                lastReindex: this.reindexLastResult,
                                indexingActivity: indexActivity
                            }
                        };
                    } finally {
                        if (suppressLogs && !this.reindexInProgress) {
                            this.context.dependencyGraph.setLoggingEnabled(true);
                        }
                    }
                }
            case 'metrics':
                {
                    const indexSnapshot = this.context.indexStateManager
                        ? await this.context.indexStateManager.getSnapshot()
                        : undefined;
                    if (indexSnapshot) {
                        this.recordIndexMetrics(indexSnapshot);
                    }
                    const budgetSnapshot = await this.buildBudgetSnapshot();
                    if (budgetSnapshot) {
                        this.recordBudgetMetrics(budgetSnapshot);
                    }
                    const snapshot = metrics.snapshot();
                    return {
                        success: true,
                        output: "Metrics snapshot.",
                        metrics: snapshot,
                        catalogCoverage: buildCatalogCoverage(snapshot, "basic")
                    };
                }
            case 'metrics_reset':
                {
                    metrics.reset();
                    return {
                        success: true,
                        output: "Metrics reset."
                    };
                }
            case 'config':
                {
                    const embeddingConfig = resolveEmbeddingConfigFromEnv();
                    return {
                        success: true,
                        output: "Config snapshot.",
                        config: {
                            metrics: {
                                mode: process.env.KAIRO_METRICS_MODE ?? "basic"
                            },
                            embedding: {
                                provider: embeddingConfig.provider ?? "auto"
                            }
                        }
                    };
                }
            case 'init':
                {
                    const bootstrapper = new ConfigBootstrapper(this.context.rootPath);
                    const result = await bootstrapper.init({
                        mode: args?.mode,
                        targets: args?.targets,
                        root: args?.root,
                        multiRepo: args?.multiRepo,
                        presets: args?.presets,
                        languageScan: args?.languageScan,
                        applyOptions: args?.applyOptions
                    });
                    return {
                        ...result,
                        output: "Config init completed."
                    };
                }
            case 'doctor':
                {
                    const bootstrapper = new ConfigBootstrapper(this.context.rootPath);
                    const result = await bootstrapper.doctor({
                        mode: args?.mode,
                        scope: args?.scope,
                        root: args?.root
                    });
                    const detail = args?.detail === "full" ? "full" : "summary";
                    const capabilityDetail = detail === "full" || args?.scope === "capabilities" ? "full" : "summary";
                    let fileCount: number | undefined;
                    const dependencyGraph = this.context.dependencyGraph;
                    if (dependencyGraph?.getIndexStatus) {
                        try {
                            const status = await dependencyGraph.getIndexStatus();
                            if (typeof status?.global?.totalFiles === "number") {
                                fileCount = status.global.totalFiles;
                            }
                        } catch {
                            fileCount = undefined;
                        }
                    }
                    const includeCapabilities = !args?.scope
                        || args?.scope === "capabilities"
                        || args?.scope === "host"
                        || args?.scope === "parity";
                    const capabilityDiagnostics = includeCapabilities
                        ? EngineManager.getDiagnosticsSnapshot({
                            detail: capabilityDetail,
                            rootPath: this.context.rootPath
                        })
                        : undefined;
                    const capabilityHints = includeCapabilities && capabilityDiagnostics
                        ? this.buildCapabilityHints(capabilityDiagnostics, { detail: capabilityDetail })
                        : undefined;
                    const overridePolicy = ConfigurationManager.getOverridePolicy();
                    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                    const recentAccepted = await AuditLog.query({
                        since,
                        filter: { decision: "accepted" },
                        limit: 1000
                    });
                    const auditStats = await AuditLog.stats();
                    const indexSnapshot = this.context.indexStateManager
                        ? await this.context.indexStateManager.getSnapshot()
                        : undefined;
                    const staleGuidance = indexSnapshot ? this.buildStaleRiskGuidance(indexSnapshot.staleRisk) : null;
                    const metricsExportStatus = this.context.metricsExportService?.getStatus();
                    const budgetSnapshot = await this.buildBudgetSnapshot();
                    const embeddingDiagnostics = computeEmbeddingDiagnostics();
                    const embeddingFindings = this.buildEmbeddingFindings(embeddingDiagnostics);
                    const rolloutStatus = this.buildRolloutStatus(fileCount);
                    const driftStatus = await this.buildWorkspaceDrift();
                    return {
                        ...result,
                        output: "Config doctor completed.",
                        ...(capabilityDiagnostics ? { capabilityDiagnostics } : {}),
                        ...(capabilityHints && capabilityHints.length > 0 ? { capabilityHints } : {}),
                        overridePolicy: {
                            enabled: overridePolicy.enabled,
                            maxTtlMinutes: overridePolicy.maxTtlMinutes,
                            maxFiles: overridePolicy.maxFiles,
                            allowed: Object.keys(overridePolicy.allowed)
                        },
                        overrideAudit: {
                            lastEventAt: auditStats.lastEventAt,
                            totalEvents: auditStats.total,
                            acceptedLast24h: recentAccepted.length,
                            ...(overridePolicy.enabled
                                ? {}
                                : { note: "Override policy is disabled; audit events are historical only." })
                        },
                        ...(indexSnapshot ? { indexSnapshot } : {}),
                        ...(staleGuidance ? { staleGuidance } : {}),
                        embeddingDiagnostics,
                        ...(embeddingFindings.length > 0 ? { embeddingFindings } : {}),
                        ...(budgetSnapshot ? { budget: budgetSnapshot } : {}),
                        ...(metricsExportStatus ? { metricsExport: metricsExportStatus } : {}),
                        drift: driftStatus,
                        rollout: rolloutStatus
                    };
                }
            case 'symbol_index_status':
                {
                    const status = this.buildSymbolIndexStatus();
                    return {
                        success: true,
                        output: "Symbol index status.",
                        status,
                        ...(status.degradedReasons ? { degradedReasons: status.degradedReasons } : {})
                    };
                }
            case 'symbol_index_build':
                {
                    const config = this.resolveSymbolSemanticSearchFlags();
                    const reasons: string[] = [];
                    if (!config.enabled) {
                        reasons.push("symbol_semantic_search_disabled");
                    }
                    if (config.enabled && !this.context.symbolEmbeddingIndex) {
                        reasons.push("embedding_provider_disabled");
                    }
                    if (reasons.length > 0) {
                        return {
                            success: false,
                            output: "Symbol semantic search is not available.",
                            degradedReasons: buildDegradedReasons(reasons)
                        };
                    }
                    const result = await this.context.symbolEmbeddingIndex!.buildIndex();
                    return {
                        success: true,
                        output: "Symbol index build completed.",
                        result,
                        status: this.context.symbolEmbeddingIndex!.getStatus()
                    };
                }
            case 'symbol_index_clear':
                {
                    const config = this.resolveSymbolSemanticSearchFlags();
                    const reasons: string[] = [];
                    if (!config.enabled) {
                        reasons.push("symbol_semantic_search_disabled");
                    }
                    if (config.enabled && !this.context.symbolEmbeddingIndex) {
                        reasons.push("embedding_provider_disabled");
                    }
                    if (reasons.length > 0) {
                        return {
                            success: false,
                            output: "Symbol semantic search is not available.",
                            degradedReasons: buildDegradedReasons(reasons)
                        };
                    }
                    const result = await this.context.symbolEmbeddingIndex!.clearIndex();
                    return {
                        success: true,
                        output: "Symbol index cleared.",
                        result,
                        status: this.context.symbolEmbeddingIndex!.getStatus()
                    };
                }
            case 'reindex':
                {
                    const suppressLogs = Boolean(args?.suppressLogs ?? args?.quiet);
                    if (suppressLogs) {
                        this.context.dependencyGraph.setLoggingEnabled(false);
                    }
                    try {
                        const paths: string[] = Array.isArray(args?.paths)
                            ? (args.paths as unknown[])
                                .map((value: unknown) => String(value).trim())
                                .filter(Boolean)
                            : [];
                        if (paths.length > 0) {
                            if (!this.context.incrementalIndexer) {
                                return {
                                    success: false,
                                    output: "Incremental indexer is unavailable; use full reindex instead.",
                                    suggestedActions: [
                                        {
                                            id: "manage.reindex.full",
                                            priority: 1,
                                            description: "Run a full reindex.",
                                            rationale: "Incremental indexing is not available in this runtime.",
                                            toolCall: { tool: "manage", args: { command: "reindex" } },
                                            tags: ["repair_ladder", "attempt_3"]
                                        }
                                    ]
                                };
                            }
                            const absPaths = paths.map((entry: string) => this.resolveAbsolutePath(entry));
                            const enqueued = this.context.incrementalIndexer.enqueuePaths(absPaths, "high");
                            this.context.cacheInvalidationHub?.onEvent({ type: "reindex_start" });
                            return {
                                success: true,
                                output: "Reindex enqueued (paths).",
                                scope: "paths",
                                enqueued,
                                paths
                            };
                        }
                        if (this.reindexInProgress) {
                            return { success: false, output: "Reindex already in progress." };
                        }
                        const startedAt = new Date();
                        this.reindexInProgress = true;
                        this.context.indexStateManager.markReindexStart();
                        this.context.cacheInvalidationHub?.onEvent({ type: "reindex_start" });
                        this.reindexLastResult = {
                            success: false,
                            output: "Reindex in progress.",
                            startedAt: startedAt.toISOString()
                        };

                        await this.context.skeletonCache.clearAll();

                        if (this.context.isTestEnv()) {
                            const finishedAt = new Date();
                            this.reindexLastResult = {
                                success: true,
                                output: "Reindex completed (test mode: caches cleared only).",
                                startedAt: startedAt.toISOString(),
                                finishedAt: finishedAt.toISOString()
                            };
                            this.reindexInProgress = false;
                            this.context.indexStateManager.markReindexComplete();
                            this.context.cacheInvalidationHub?.onEvent({ type: "reindex_complete" });
                            return { success: true, output: "Reindex completed (test mode).", activity: { reindexInProgress: false } };
                        }

                        void (async () => {
                            try {
                                await this.context.searchEngine.rebuild({ logEvery: 500 });
                                await this.context.dependencyGraph.build({ logEvery: 200 });
                                if (this.context.documentIndexer) {
                                    await this.context.documentIndexer.rebuildAll();
                                }
                                const finishedAt = new Date();
                                this.reindexLastResult = {
                                    success: true,
                                    output: "Reindex completed.",
                                    startedAt: startedAt.toISOString(),
                                    finishedAt: finishedAt.toISOString()
                                };
                                this.context.indexStateManager.markReindexComplete();
                                this.context.cacheInvalidationHub?.onEvent({ type: "reindex_complete" });
                            } catch (error: any) {
                                const finishedAt = new Date();
                                this.reindexLastResult = {
                                    success: false,
                                    output: error?.message ?? "Reindex failed.",
                                    startedAt: startedAt.toISOString(),
                                    finishedAt: finishedAt.toISOString()
                                };
                                this.context.indexStateManager.markReindexFailed();
                            } finally {
                                this.reindexInProgress = false;
                                if (suppressLogs) {
                                    this.context.dependencyGraph.setLoggingEnabled(true);
                                }
                            }
                        })();
                        return { success: true, output: "Reindex started.", activity: { reindexInProgress: true } };
                    } finally {
                        if (suppressLogs) {
                            this.context.dependencyGraph.setLoggingEnabled(true);
                        }
                    }
                }
            case 'history':
                {
                    const history = await this.context.historyEngine.getHistory();
                    const detail = args?.detail === "full" ? "full" : "summary";
                    const log = this.context.editCoordinator.getTransactionLog();
                    const pending = log ? log.getPendingTransactions() : [];
                    const checkpointLimit = typeof args?.checkpointLimit === "number" ? args.checkpointLimit : 10;
                    const committed = log ? log.listTransactions({ status: "committed", limit: checkpointLimit }) : [];
                    const sanitized = this.sanitizeHistoryStacks(history, { includeExternal: detail === "full" });
                    return {
                        success: true,
                        output: "History retrieved.",
                        history: {
                            undo: sanitized.undoStack,
                            redo: sanitized.redoStack,
                            pendingTransactions: pending,
                            checkpoints: this.summarizeCheckpoints(committed)
                        },
                        ...(sanitized.hiddenCount > 0
                            ? { historyMeta: { externalPathsHidden: sanitized.hiddenCount, detail } }
                            : {})
                    };
                }
            case 'test':
                {
                    const target = args?.target;
                    if (!target && scope !== 'project') {
                        return { success: false, output: "Missing target for test command." };
                    }
                    const absPath = target ? this.resolveAbsolutePath(target) : undefined;
                    const report = absPath ? await this.context.impactAnalyzer.analyzeImpact(absPath, []) : null;
                    return {
                        success: true,
                        output: "Suggested tests generated.",
                        suggestedTests: report?.suggestedTests ?? []
                    };
                }
            case 'sessions':
                {
                    const limit = typeof args?.limit === "number" ? args.limit : (args?.artifactOptions?.limit ?? 10);
                    const sessions = this.context.flowArtifactManager.listSessions(limit);
                    return {
                        success: true,
                        output: "Sessions listed.",
                        sessions
                    };
                }
            case 'session':
                {
                    const target = args?.target ?? args?.sessionId ?? args?.artifactOptions?.sessionId;
                    if (!target) {
                        return { success: false, output: "Missing target session id." };
                    }
                    const summary = this.context.flowArtifactManager.getSessionSummary(target);
                    const session = summary?.session;
                    return {
                        success: Boolean(session),
                        output: session ? "Session retrieved." : "Session not found.",
                        session,
                        summary: summary?.summary
                    };
                }
            case 'session_complete':
                {
                    const target = args?.target ?? args?.sessionId ?? args?.artifactOptions?.sessionId;
                    if (!target) {
                        return { success: false, output: "Missing target session id." };
                    }
                    const outcome = args?.outcome;
                    const completed = this.context.flowArtifactManager.completeSession(target, outcome);
                    const summary = completed ? this.context.flowArtifactManager.getSessionSummary(target) : undefined;
                    return {
                        success: Boolean(completed),
                        output: completed ? "Session completed." : "Session not found.",
                        session: completed,
                        summary: summary?.summary
                    };
                }
            case 'session_update':
                {
                    const target = args?.target ?? args?.sessionId ?? args?.artifactOptions?.sessionId;
                    if (!target) {
                        return { success: false, output: "Missing target session id." };
                    }
                    const policy = args?.policy;
                    const policyMode = args?.policyMode === "replace" ? "replace" : "merge";
                    const updated = await this.context.flowArtifactManager.updateSessionPolicy(target, policy, policyMode);
                    const summary = updated ? this.context.flowArtifactManager.getSessionSummary(target) : undefined;
                    return {
                        success: Boolean(updated),
                        output: updated ? "Session policy updated." : "Session not found.",
                        session: updated,
                        summary: summary?.summary
                    };
                }
            case 'artifacts':
                {
                    const options = args?.artifactOptions ?? {};
                    const limit = typeof options.limit === "number" ? options.limit : 10;
                    let artifacts = this.context.flowArtifactManager.getRecent(limit);
                    if (options.type) {
                        artifacts = artifacts.filter((artifact) => artifact.type === options.type);
                    }
                    if (options.sessionId) {
                        artifacts = artifacts.filter((artifact) => artifact.sessionId === options.sessionId);
                    }
                    if (options.includeExpired !== true) {
                        const now = Date.now();
                        artifacts = artifacts.filter((artifact) => !artifact.expiresAt || artifact.expiresAt > now);
                    }
                    return {
                        success: true,
                        output: "Artifacts listed.",
                        artifacts
                    };
                }
            case 'artifact':
                {
                    const target = args?.target;
                    if (!target) {
                        return { success: false, output: "Missing target artifact id." };
                    }
                    const artifact = this.context.flowArtifactManager.get(target);
                    return {
                        success: Boolean(artifact),
                        output: artifact ? "Artifact retrieved." : "Artifact not found.",
                        artifact
                    };
                }
            case 'discard':
                {
                    const target = args?.target;
                    if (!target) {
                        return { success: false, output: "Missing target artifact id." };
                    }
                    const discarded = this.context.flowArtifactManager.discard(target);
                    return {
                        success: discarded,
                        output: discarded ? "Artifact discarded." : "Artifact not found."
                    };
                }
            case 'prune':
                {
                    const mode = args?.mode === "plan" ? "plan" : "apply";
                    const service = new StorageMaintenanceService(
                        this.context.indexDatabase,
                        this.context.documentSearchEngine,
                        this.context.flowArtifactManager
                    );
                    return service.prune({
                        mode,
                        targets: args?.pruneOptions?.targets,
                        includeExpired: args?.pruneOptions?.includeExpired,
                        includeStale: args?.pruneOptions?.includeStale,
                        enforceCaps: args?.pruneOptions?.enforceCaps,
                        compact: args?.pruneOptions?.compact,
                        limits: args?.pruneOptions?.limits,
                        flowArtifacts: args?.pruneOptions?.flowArtifacts
                    });
                }
            case 'export':
                {
                    const target = args?.target;
                    if (!target) {
                        return { success: false, output: "Missing target artifact id." };
                    }
                    const artifact = this.context.flowArtifactManager.get(target);
                    if (!artifact) {
                        return { success: false, output: "Artifact not found." };
                    }
                    const filePath = await this.context.flowArtifactManager.persist(target, artifact);
                    return {
                        success: true,
                        output: "Artifact exported.",
                        path: filePath
                    };
                }
            case 'import':
                {
                    const target = args?.target;
                    if (!target) {
                        return { success: false, output: "Missing artifact file path." };
                    }
                    const artifact = await this.context.flowArtifactManager.importFromPath(target);
                    return {
                        success: Boolean(artifact),
                        output: artifact ? "Artifact imported." : "Artifact import failed.",
                        artifact
                    };
                }
            default:
                return { success: false, output: `Unknown project_manage command: ${command}` };
        }
    }

    private buildCapabilityHints(
        snapshot: ReturnType<typeof EngineManager.getDiagnosticsSnapshot>,
        options?: { detail?: "summary" | "full" }
    ): string[] {
        const hints: string[] = [];
        const actionHints: Record<string, string> = {
            CAP_CHUNKING_TOKENS: "Enable Rust chunking (KAIRO_RUST_CORE_ENABLED/KAIRO_RUST_CHUNKING_ENABLED) or WASM chunking (KAIRO_WASM_CHUNKING_ENABLED).",
            CAP_DIFF_UNIFIED: "Enable Rust diffing (KAIRO_RUST_CORE_ENABLED/KAIRO_RUST_DIFF_ENABLED) or rely on JS diffing (default).",
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
    }

    private sanitizeHistoryStacks(
        history: { undoStack: any[]; redoStack: any[] },
        options: { includeExternal: boolean }
    ): { undoStack: any[]; redoStack: any[]; hiddenCount: number } {
        const pathNormalizer = this.context.pathNormalizer;
        if (options.includeExternal || typeof pathNormalizer?.isWithinRoot !== "function") {
            return { undoStack: history.undoStack, redoStack: history.redoStack, hiddenCount: 0 };
        }
        const mask = (op: any): { op: any; hidden: number } => {
            if (typeof op?.filePath === "string" && !pathNormalizer.isWithinRoot(op.filePath)) {
                return { op: { ...op, filePath: "<external>" }, hidden: 1 };
            }
            return { op, hidden: 0 };
        };
        const sanitizeItem = (item: any): { item: any; hidden: number } => {
            if (Array.isArray(item?.operations)) {
                let hidden = 0;
                const operations = item.operations.map((op: any) => {
                    const masked = mask(op);
                    hidden += masked.hidden;
                    return masked.op;
                });
                return { item: { ...item, operations }, hidden };
            }
            const masked = mask(item);
            return { item: masked.op, hidden: masked.hidden };
        };
        const sanitizeStack = (stack: any[]) => {
            let hiddenCount = 0;
            const items = stack.map((entry) => {
                const sanitized = sanitizeItem(entry);
                hiddenCount += sanitized.hidden;
                return sanitized.item;
            });
            return { items, hiddenCount };
        };
        const undo = sanitizeStack(Array.isArray(history.undoStack) ? history.undoStack : []);
        const redo = sanitizeStack(Array.isArray(history.redoStack) ? history.redoStack : []);
        return {
            undoStack: undo.items,
            redoStack: redo.items,
            hiddenCount: undo.hiddenCount + redo.hiddenCount
        };
    }

    private recordIndexMetrics(snapshot: { epoch: number; dirtyFileCount: number; coverageRatio: number; staleRisk: "low" | "medium" | "high" }): void {
        metrics.gauge("index.epoch", snapshot.epoch);
        metrics.gauge("index.dirty_files", snapshot.dirtyFileCount);
        metrics.gauge("index.coverage_ratio", snapshot.coverageRatio);
        const riskLevel = snapshot.staleRisk === "high" ? 2 : snapshot.staleRisk === "medium" ? 1 : 0;
        metrics.gauge("index.stale_risk_level", riskLevel);
        metrics.inc("cache.invalidate.file_total", 0);
        metrics.inc("cache.invalidate.dir_total", 0);
        metrics.inc("cache.invalidate.all_total", 0);
    }

    private async buildBudgetSnapshot(): Promise<{
        indexDirBytes: number;
        storageDirBytes: number;
        symbolSecondaryIndexEnabled: boolean;
        symbolSecondaryIndexBytes?: number;
    } | null> {
        try {
            const indexDir = PathManager.getIndexDir();
            const storageDir = PathManager.getStorageDir();
            const indexDirBytes = await this.getDirectorySizeBytes(indexDir);
            const storageDirBytes = await this.getDirectorySizeBytes(storageDir);
            const secondaryStatus = this.context.indexDatabase?.getSecondaryIndexStatus?.();
            return {
                indexDirBytes,
                storageDirBytes,
                symbolSecondaryIndexEnabled: secondaryStatus?.enabled ?? false,
                ...(secondaryStatus?.bytes !== undefined ? { symbolSecondaryIndexBytes: secondaryStatus.bytes } : {})
            };
        } catch {
            return null;
        }
    }

    private recordBudgetMetrics(snapshot: {
        indexDirBytes: number;
        storageDirBytes: number;
        symbolSecondaryIndexEnabled: boolean;
        symbolSecondaryIndexBytes?: number;
    }): void {
        metrics.gauge("budget.index_dir_bytes", snapshot.indexDirBytes);
        metrics.gauge("budget.storage_dir_bytes", snapshot.storageDirBytes);
        if (snapshot.symbolSecondaryIndexBytes !== undefined) {
            metrics.gauge("budget.symbol_secondary_index_bytes", snapshot.symbolSecondaryIndexBytes);
        }
        metrics.gauge("symbol.search.secondary_index_enabled", snapshot.symbolSecondaryIndexEnabled ? 1 : 0);
    }

    private async getDirectorySizeBytes(dirPath: string): Promise<number> {
        let total = 0;
        const stack: string[] = [dirPath];
        while (stack.length > 0) {
            const current = stack.pop()!;
            let entries: string[] = [];
            try {
                entries = await this.context.fileSystem.readDir(current);
            } catch {
                continue;
            }
            for (const entry of entries) {
                const fullPath = path.join(current, entry);
                try {
                    const stat = await this.context.fileSystem.stat(fullPath);
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
    }

    private buildStaleRiskGuidance(level: "low" | "medium" | "high") {
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
    }

    private buildEmbeddingFindings(diagnostics: ReturnType<typeof computeEmbeddingDiagnostics>): Array<{ code: string; severity: "info" | "warning" | "critical"; message: string }> {
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
    }
}
