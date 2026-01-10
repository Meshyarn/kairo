import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { metrics } from "../utils/MetricsCollector.js";
import { resolveEmbeddingConfigFromEnv } from "../embeddings/EmbeddingConfig.js";

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

                        if (includePerFile) {
                            return {
                                success: true,
                                output: "Index status",
                                status,
                                embedding: embeddingStatus,
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
                    return {
                        success: true,
                        output: "Metrics snapshot.",
                        metrics: metrics.snapshot()
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
                    const updated = this.context.flowArtifactManager.updateSessionPolicy(target, policy, policyMode);
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
                    const pruned = this.context.flowArtifactManager.prune();
                    return {
                        success: true,
                        output: "Expired artifacts pruned.",
                        pruned
                    };
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
}
