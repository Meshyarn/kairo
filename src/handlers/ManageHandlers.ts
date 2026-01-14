import * as fs from "fs";
import * as path from "path";
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

export class ManageHandlers extends BaseHandler {
    private reindexInProgress = false;
    private reindexLastResult?: { success: boolean; output: string; startedAt: string; finishedAt?: string };

    constructor(private context: HandlerContext) {
        super();
    }

    async handle(name: string, args: any): Promise<any> {
        const pillarTools = new Set(['manage']);
        const internalTools = new Set(['project_manage']);

        if (pillarTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args, { manage: ['command'] });
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }
            const result = await this.context.orchestrationEngine.executePillar(name, args);
            return this.jsonResponse(result);
        }

        if (internalTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args, { project_manage: ['command'] });
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
                    const budgetSnapshot = this.buildBudgetSnapshot();
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
                    const includeCapabilities = !args?.scope
                        || args?.scope === "capabilities"
                        || args?.scope === "host"
                        || args?.scope === "parity";
                    const capabilityDiagnostics = includeCapabilities
                        ? EngineManager.getDiagnosticsSnapshot({
                            detail: args?.detail === "full" ? "full" : "summary",
                            rootPath: this.context.rootPath
                        })
                        : undefined;
                    const capabilityHints = includeCapabilities && capabilityDiagnostics
                        ? this.buildCapabilityHints(capabilityDiagnostics)
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
                    const budgetSnapshot = this.buildBudgetSnapshot();
                    const embeddingDiagnostics = computeEmbeddingDiagnostics();
                    const embeddingFindings = this.buildEmbeddingFindings(embeddingDiagnostics);
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
                            acceptedLast24h: recentAccepted.length
                        },
                        ...(indexSnapshot ? { indexSnapshot } : {}),
                        ...(staleGuidance ? { staleGuidance } : {}),
                        embeddingDiagnostics,
                        ...(embeddingFindings.length > 0 ? { embeddingFindings } : {}),
                        ...(budgetSnapshot ? { budget: budgetSnapshot } : {}),
                        ...(metricsExportStatus ? { metricsExport: metricsExportStatus } : {})
                    };
                }
            case 'reindex':
                {
                    const suppressLogs = Boolean(args?.suppressLogs ?? args?.quiet);
                    if (suppressLogs) {
                        this.context.dependencyGraph.setLoggingEnabled(false);
                    }
                    try {
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
                    const log = this.context.editCoordinator.getTransactionLog();
                    const pending = log ? log.getPendingTransactions() : [];
                    return {
                        success: true,
                        output: "History retrieved.",
                        history: {
                            undo: history.undoStack,
                            redo: history.redoStack,
                            pendingTransactions: pending
                        }
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

    private buildCapabilityHints(snapshot: ReturnType<typeof EngineManager.getDiagnosticsSnapshot>): string[] {
        const hints: string[] = [];
        if (!snapshot.rustCore.available && snapshot.rustCore.error) {
            hints.push(`Rust core unavailable: ${snapshot.rustCore.error}`);
        }
        const tokenizer = snapshot.tokenizer;
        if (tokenizer?.missingReason) {
            hints.push(tokenizer.missingReason);
        }
        return hints;
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

    private buildBudgetSnapshot(): {
        indexDirBytes: number;
        storageDirBytes: number;
        symbolSecondaryIndexEnabled: boolean;
        symbolSecondaryIndexBytes?: number;
    } | null {
        try {
            const indexDir = PathManager.getIndexDir();
            const storageDir = PathManager.getStorageDir();
            const indexDirBytes = this.getDirectorySizeBytes(indexDir);
            const storageDirBytes = this.getDirectorySizeBytes(storageDir);
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

    private getDirectorySizeBytes(dirPath: string): number {
        let total = 0;
        const stack: string[] = [dirPath];
        while (stack.length > 0) {
            const current = stack.pop()!;
            let entries: string[] = [];
            try {
                entries = fs.readdirSync(current);
            } catch {
                continue;
            }
            for (const entry of entries) {
                const fullPath = path.join(current, entry);
                let stat: fs.Stats;
                try {
                    stat = fs.statSync(fullPath);
                } catch {
                    continue;
                }
                if (stat.isDirectory()) {
                    stack.push(fullPath);
                } else if (stat.isFile()) {
                    total += stat.size;
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
                message: "Remote embeddings downloads are enabled; offline baseline is not guaranteed."
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
