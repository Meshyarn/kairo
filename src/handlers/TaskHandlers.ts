import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { IntentRouter } from "../orchestration/IntentRouter.js";
import type { ExploreResponse } from "../orchestration/pillars/explore/ResultFormatter.js";
import { resolveAutopilotPolicy, resolvePublicSurface } from "../orchestration/policy/McpModePresetRegistry.js";

type TaskMode = "auto" | "ask" | "analyze" | "plan_change" | "apply_change" | "write" | "verify";
type TaskBudget = "lean" | "balanced" | "deep";
type TaskProfile = "lean" | "fast" | "balanced" | "deep";
type AutoRepairAttempt = {
    tool: string;
    args: Record<string, unknown>;
    status: "success" | "failure";
    summary: string;
    packId?: string;
    message?: string;
};
type AutoRepairReport = {
    attempts: AutoRepairAttempt[];
};

const AUTO_REPAIR_REINDEX_PATH_LIMIT = 25;

export class TaskHandlers extends BaseHandler {
    private intentRouter = new IntentRouter();

    constructor(private context: HandlerContext) {
        super(context.toolSpecRegistry);
    }

    async handle(name: string, args: any): Promise<any> {
        if (name !== "task") return null;
        const missing = this.validateRequiredArgs(name, args);
        if (missing.length > 0) {
            return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(", ")}`);
        }
        const result = await this.executeTask(args);
        return this.jsonResponse(result);
    }

    private normalizeMode(raw: any): TaskMode {
        if (raw === "ask" || raw === "analyze" || raw === "auto" || raw === "plan_change" || raw === "apply_change" || raw === "write" || raw === "verify") {
            return raw;
        }
        return "auto";
    }

    private normalizeBudget(raw: any): TaskBudget {
        if (raw === "balanced" || raw === "deep" || raw === "lean") {
            return raw;
        }
        return "lean";
    }

    private resolveProfile(budget: TaskBudget): TaskProfile {
        if (budget === "balanced") return "balanced";
        if (budget === "deep") return "deep";
        return "lean";
    }

    private resolveRoutingMode(mode: TaskMode, request: string) {
        if (mode !== "auto") {
            return { mode, category: undefined as string | undefined };
        }
        const parsed = this.intentRouter.parse(request);
        const category = parsed.category;
        if (category === "understand") return { mode: "analyze" as TaskMode, category };
        if (category === "explore" || category === "navigate" || category === "read") {
            return { mode: "ask" as TaskMode, category };
        }
        if (category === "change") return { mode: "plan_change" as TaskMode, category };
        return { mode: "ask" as TaskMode, category };
    }

    private extractPaths(value: any): string[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item) => typeof item === "string" && item.length > 0);
    }

    private extractEdits(value: any): any[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item) => item !== null && item !== undefined);
    }

    private extractMaxTokens(value: any): number | undefined {
        const raw = value?.maxTokens;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
        return parsed;
    }

    private buildNextCalls(args: {
        category?: string;
        request: string;
        targetFiles: string[];
    }): Array<{ tool: string; args: Record<string, unknown>; reason?: string }> | undefined {
        const nextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = [];
        if (args.category === "change") {
            nextCalls.push({
                tool: "change",
                args: {
                    intent: args.request,
                    targetFiles: args.targetFiles.length > 0 ? args.targetFiles : undefined,
                    safety: "plan"
                },
                reason: "Change request detected; use plan mode to review safely."
            });
        }
        if (args.category === "write") {
            nextCalls.push({
                tool: "write",
                args: {
                    intent: args.request,
                    safety: "plan"
                },
                reason: "Write request detected; use plan mode to draft safely."
            });
        }
        if (args.category === "manage") {
            nextCalls.push({
                tool: "manage",
                args: { command: "status" },
                reason: "Management request detected; start with status."
            });
        }
        return nextCalls.length > 0 ? nextCalls : undefined;
    }

    private buildExploreSummary(args: {
        response: ExploreResponse;
        request: string;
        routingNote?: string;
    }): { title: string; bullets: string[]; next: string[] } {
        const response = args.response;
        const docsCount = response?.data?.docs?.length ?? 0;
        const codeCount = response?.data?.code?.length ?? 0;
        const status = response?.status ?? "ok";
        const topCode = response?.data?.code?.slice(0, 3).map((item) => item.filePath).filter(Boolean) ?? [];
        const topDocs = response?.data?.docs?.slice(0, 3).map((item) => item.filePath).filter(Boolean) ?? [];
        const bullets = [
            `Results: ${codeCount} code, ${docsCount} docs (status=${status}).`,
            topCode.length > 0 ? `Top code: ${topCode.join(", ")}.` : "Top code: none.",
            topDocs.length > 0 ? `Top docs: ${topDocs.join(", ")}.` : "Top docs: none."
        ];
        if (args.routingNote) {
            bullets.push(args.routingNote);
        }
        const next: string[] = [];
        if (response?.pack?.packId) {
            next.push("Use manage artifact/export to inspect the explore pack.");
        }
        return {
            title: `Explore results for "${args.request}".`,
            bullets,
            next
        };
    }

    private buildUnderstandSummary(args: {
        response: any;
        request: string;
    }): { title: string; bullets: string[]; next: string[] } {
        const response = args.response ?? {};
        const primaryFile = typeof response.primaryFile === "string" ? response.primaryFile : "unknown";
        const symbols = Array.isArray(response.symbols) ? response.symbols.length : 0;
        const deps = Array.isArray(response.dependencies) ? response.dependencies.length : 0;
        const summaryLine = typeof response.summary === "string" ? response.summary : `Analysis for "${args.request}".`;
        const bullets = [
            summaryLine,
            `Primary file: ${primaryFile}.`,
            `Signals: symbols=${symbols}, dependencies=${deps}.`
        ];
        const next: string[] = [];
        if (response.callGraphArtifactId) {
            next.push("Use manage artifact to review the call graph summary.");
        }
        return {
            title: `Analysis results for "${args.request}".`,
            bullets,
            next
        };
    }

    private buildGuidance(guidance: any, nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }>) {
        const suggested = Array.isArray(guidance?.suggestedActions) ? guidance.suggestedActions : undefined;
        const computedNextCalls = nextCalls ?? (Array.isArray(suggested)
            ? suggested
                .map((action: any) => action?.toolCall ? { tool: action.toolCall.tool, args: action.toolCall.args, reason: action.description } : null)
                .filter(Boolean)
            : undefined);
        if (!suggested && !computedNextCalls) {
            return undefined;
        }
        return {
            ...(suggested ? { suggestedActions: suggested } : {}),
            ...(computedNextCalls ? { nextCalls: computedNextCalls } : {})
        };
    }

    private resolveAutoRepairSettings(budget: TaskBudget) {
        const policy = resolveAutopilotPolicy();
        const maxAttempts = Number.isFinite(policy.maxAutoRepairAttempts) ? policy.maxAutoRepairAttempts : 0;
        const enabled = maxAttempts > 0 && budget === "lean";
        return {
            enabled,
            maxAttempts,
            allowAutoReindex: policy.allowAutoReindex
        };
    }

    private extractFilePathFromResponse(response: any): string | undefined {
        const degraded = Array.isArray(response?.degradedReasons) ? response.degradedReasons : [];
        for (const entry of degraded) {
            if (entry && typeof entry.filePath === "string" && entry.filePath.length > 0) {
                return entry.filePath;
            }
        }
        if (typeof response?.targetFile === "string" && response.targetFile.length > 0) return response.targetFile;
        if (typeof response?.targetPath === "string" && response.targetPath.length > 0) return response.targetPath;
        if (typeof response?.filePath === "string" && response.filePath.length > 0) return response.filePath;
        return undefined;
    }

    private async attemptAutoRepair(args: {
        response: any;
        sessionId?: string;
        profile: TaskProfile;
        maxTokens?: number;
        budget: TaskBudget;
        targetFiles: string[];
        paths: string[];
    }): Promise<AutoRepairReport | undefined> {
        const settings = this.resolveAutoRepairSettings(args.budget);
        if (!settings.enabled) return undefined;
        const response = args.response;
        if (!response || (response.success !== false && response.status !== "blocked")) {
            return undefined;
        }
        const blockedReason = typeof response?.blockedReason === "string" ? response.blockedReason : "";
        const errorCode = typeof response?.errorCode === "string" ? response.errorCode : "";
        const attempts: AutoRepairAttempt[] = [];

        if (blockedReason === "file_version_mismatch" || errorCode === "FILE_VERSION_MISMATCH") {
            const filePath = this.extractFilePathFromResponse(response)
                ?? args.targetFiles[0]
                ?? args.paths[0];
            if (!filePath) return undefined;
            const exploreArgs: Record<string, unknown> = {
                paths: [filePath],
                sessionId: args.sessionId,
                profile: args.profile,
                view: "preview",
                ...(args.maxTokens ? { limits: { maxTokens: args.maxTokens } } : {})
            };
            try {
                const exploreResponse = await this.context.orchestrationEngine.executePillar("explore", exploreArgs);
                const packId = exploreResponse?.pack?.packId ?? exploreResponse?.researchPack?.id;
                attempts.push({
                    tool: "explore",
                    args: exploreArgs,
                    status: exploreResponse?.success === false ? "failure" : "success",
                    summary: exploreResponse?.success === false
                        ? `Preview refresh failed for ${filePath}.`
                        : `Preview refreshed for ${filePath}.`,
                    ...(packId ? { packId } : {})
                });
            } catch (error: any) {
                attempts.push({
                    tool: "explore",
                    args: exploreArgs,
                    status: "failure",
                    summary: `Preview refresh failed for ${filePath}.`,
                    message: error?.message ?? "Auto-repair failed."
                });
            }
            return attempts.length > 0 ? { attempts } : undefined;
        }

        if (blockedReason === "index_stale_high" || errorCode === "INDEX_STALE_HIGH") {
            if (!settings.allowAutoReindex) return undefined;
            const indexStateManager = this.context.indexStateManager;
            if (!indexStateManager || typeof indexStateManager.getDirtyFiles !== "function") {
                return undefined;
            }
            const dirtyPaths = indexStateManager.getDirtyFiles(AUTO_REPAIR_REINDEX_PATH_LIMIT);
            if (dirtyPaths.length === 0) return undefined;
            const manageArgs: Record<string, unknown> = {
                command: "reindex",
                paths: dirtyPaths
            };
            const dirtyCount = typeof response?.indexSnapshot?.dirtyFileCount === "number"
                ? response.indexSnapshot.dirtyFileCount
                : dirtyPaths.length;
            try {
                const manageResponse = await this.context.orchestrationEngine.executePillar("manage", manageArgs);
                const truncated = dirtyCount > dirtyPaths.length;
                const summary = manageResponse?.success === false
                    ? "Reindex auto-repair failed."
                    : (truncated
                        ? `Reindex enqueued for ${dirtyPaths.length} of ${dirtyCount} dirty paths.`
                        : `Reindex enqueued for ${dirtyPaths.length} path(s).`);
                attempts.push({
                    tool: "manage",
                    args: manageArgs,
                    status: manageResponse?.success === false ? "failure" : "success",
                    summary
                });
            } catch (error: any) {
                attempts.push({
                    tool: "manage",
                    args: manageArgs,
                    status: "failure",
                    summary: "Reindex auto-repair failed.",
                    message: error?.message ?? "Auto-repair failed."
                });
            }
            return attempts.length > 0 ? { attempts } : undefined;
        }

        return undefined;
    }

    private mapStatus(response: any): "success" | "partial_success" | "blocked" {
        const status = response?.status;
        if (status === "partial_success") return "partial_success";
        if (status === "blocked" || response?.success === false) return "blocked";
        return "success";
    }

    private async buildFileVersionsSnapshot(paths: string[]): Promise<Record<string, { expectedVersion?: number; expectedHash?: string }> | undefined> {
        const fileVersionManager = this.context.fileVersionManager;
        const pathNormalizer = this.context.pathNormalizer;
        if (!fileVersionManager || !pathNormalizer) return undefined;
        const snapshot: Record<string, { expectedVersion?: number; expectedHash?: string }> = {};
        const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
        for (const filePath of uniquePaths) {
            const relPath = pathNormalizer.normalize(filePath);
            try {
                const absPath = pathNormalizer.toAbsolute(relPath);
                const versionInfo = await fileVersionManager.getVersion(absPath);
                snapshot[relPath] = {
                    expectedVersion: versionInfo.version,
                    expectedHash: versionInfo.contentHash
                };
            } catch {
                // skip missing files
            }
        }
        return Object.keys(snapshot).length > 0 ? snapshot : undefined;
    }

    private buildPlanPrepSummary(args: {
        request: string;
        recommendedTargets: string[];
        packId?: string;
    }): { title: string; bullets: string[]; next: string[] } {
        const recommended = args.recommendedTargets.length > 0
            ? args.recommendedTargets.slice(0, 5).join(", ")
            : "none";
        const bullets = [
            `Recommended targets: ${recommended}.`,
            "Provide explicit edits to generate a change plan."
        ];
        const next: string[] = [];
        if (args.packId) {
            next.push("Use manage artifact/export to inspect the explore pack.");
        }
        next.push("Call task with mode=plan_change and edits to generate a DraftPack.");
        return {
            title: `Change prep for "${args.request}".`,
            bullets,
            next
        };
    }

    private buildPlanSummary(args: {
        response: any;
        request: string;
    }): { title: string; bullets: string[]; next: string[] } {
        const response = args.response ?? {};
        const draftId = response?.draftPack?.id ?? "none";
        const reviewId = response?.review?.id ?? "none";
        const impact = response?.impactReport ? "present" : "none";
        const diffBytes = typeof response?.diff === "string" ? response.diff.length : 0;
        const bullets = [
            `Draft pack: ${draftId}.`,
            `Review: ${reviewId}.`,
            `Impact: ${impact}.`,
            `Diff bytes: ${diffBytes}.`
        ];
        const next: string[] = [];
        if (draftId !== "none") {
            next.push("Use manage artifact to review the draft pack.");
        }
        if (reviewId !== "none") {
            next.push("Use manage artifact to review the pre-apply review.");
        }
        return {
            title: `Change plan for "${args.request}".`,
            bullets,
            next
        };
    }

    private buildApplySummary(args: {
        response: any;
        request: string;
    }): { title: string; bullets: string[]; next: string[] } {
        const response = args.response ?? {};
        const targetFile = typeof response?.targetFile === "string"
            ? response.targetFile
            : (typeof response?.targetPath === "string" ? response.targetPath : "unknown");
        const status = response?.status ?? "ok";
        const rollback = response?.rollbackAvailable ? "yes" : "no";
        const reviewId = response?.postReview?.id ?? response?.review?.id ?? "none";
        const bullets = [
            `Target: ${targetFile}.`,
            `Status: ${status}.`,
            `Rollback available: ${rollback}.`,
            `Review: ${reviewId}.`
        ];
        const next: string[] = [];
        if (reviewId !== "none") {
            next.push("Use manage artifact to review the apply review.");
        }
        if (rollback === "yes") {
            next.push("Use manage history to inspect or rollback.");
        }
        return {
            title: `Change apply result for "${args.request}".`,
            bullets,
            next
        };
    }

    private async executeTask(args: any) {
        const startedAt = Date.now();
        const request = typeof args?.request === "string" ? args.request.trim() : "";
        const mode = this.normalizeMode(args?.mode);
        const budget = this.normalizeBudget(args?.budget);
        const profile = this.resolveProfile(budget);
        const outputFormat = args?.output?.format === "standard" ? "standard" : "summary";
        const maxTokens = this.extractMaxTokens(args?.output);
        const sessionId = typeof args?.sessionId === "string" ? args.sessionId : undefined;
        const draftId = typeof args?.draftId === "string" ? args.draftId : undefined;
        const applyToken = typeof args?.applyToken === "string" ? args.applyToken : undefined;
        const paths = this.extractPaths(args?.paths);
        const targetFiles = this.extractPaths(args?.targetFiles);
        const edits = this.extractEdits(args?.edits);
        const traceEnabled = args?.trace === true;
        const surface = resolvePublicSurface();

        const routing = this.resolveRoutingMode(mode, request);
        const routingNote = routing.category === "change" || routing.category === "write" || routing.category === "manage"
            ? "Change/write/manage intent detected; returning read-only context."
            : undefined;
        const nextCalls = this.buildNextCalls({
            category: routing.category,
            request,
            targetFiles
        });

        if (routing.mode === "analyze") {
            const response = await this.context.orchestrationEngine.executePillar("understand", {
                goal: request,
                targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
                sessionId,
                profile,
                trace: traceEnabled,
                limits: maxTokens ? { maxTokens } : undefined
            });
            const summary = this.buildUnderstandSummary({ response, request });
            const guidance = this.buildGuidance(response?.guidance, nextCalls);
            const artifacts = response?.callGraphArtifactId
                ? [{ id: response.callGraphArtifactId, kind: "call_graph", detail: "summary" }]
                : undefined;
            return {
                ok: true,
                sessionId: response?.sessionId ?? sessionId,
                status: this.mapStatus(response),
                mode: routing.mode,
                budget,
                surface,
                summary: outputFormat === "summary" ? summary : summary,
                ...(artifacts ? { artifacts } : {}),
                ...(response?.degraded !== undefined ? { degraded: response.degraded } : {}),
                ...(response?.degradedReasons ? { degradedReasons: response.degradedReasons } : {}),
                ...(guidance ? { guidance } : {}),
                stats: {
                    latencyMs: Date.now() - startedAt
                }
            };
        }

        if (routing.mode === "plan_change") {
            const planTargets = targetFiles.length > 0 ? targetFiles : (paths.length > 0 ? paths : []);
            const planLimits = maxTokens ? { maxTokens } : undefined;
            if (edits.length === 0) {
                const response = await this.context.orchestrationEngine.executePillar("explore", {
                    query: request,
                    paths: paths.length > 0 ? paths : undefined,
                    targetFiles: planTargets.length > 0 ? planTargets : undefined,
                    sessionId,
                    profile,
                    view: "preview",
                    trace: traceEnabled,
                    limits: planLimits
                });
                const packId = response?.pack?.packId ?? response?.researchPack?.id;
                const codeTargets = response?.data?.code
                    ?.map((item: any) => item?.filePath)
                    .filter((filePath: any) => typeof filePath === "string") ?? [];
                const recommendedTargets = Array.from(new Set([...planTargets, ...codeTargets])).slice(0, 10);
                const fileVersions = await this.buildFileVersionsSnapshot(recommendedTargets);
                const editsTemplate = {
                    edits: [
                        {
                            filePath: recommendedTargets[0] ?? "<path>",
                            targetString: "<exact text>",
                            replacementString: "<replacement>"
                        }
                    ]
                };
                const summary = this.buildPlanPrepSummary({ request, recommendedTargets, packId });
                const guidance = this.buildGuidance(response?.guidance, nextCalls);
                return {
                    ok: true,
                    sessionId: response?.sessionId ?? sessionId,
                    status: "partial_success",
                    mode: routing.mode,
                    budget,
                    surface,
                    summary: outputFormat === "summary" ? summary : summary,
                    ...(packId ? { packId } : {}),
                    changePrep: {
                        recommendedTargets,
                        ...(fileVersions ? { fileVersions } : {}),
                        editsTemplate
                    },
                    ...(response?.degraded !== undefined ? { degraded: response.degraded } : {}),
                    ...(response?.degradedReasons ? { degradedReasons: response.degradedReasons } : {}),
                    ...(guidance ? { guidance } : {}),
                    stats: {
                        latencyMs: Date.now() - startedAt
                    }
                };
            }

            const response = await this.context.orchestrationEngine.executePillar("change", {
                intent: request,
                targetFiles: planTargets.length > 0 ? planTargets : undefined,
                edits,
                sessionId,
                profile,
                safety: "plan",
                trace: traceEnabled,
                ...(typeof args?.refinement === "string" ? { refinement: args.refinement } : {}),
                ...(draftId ? { draftId } : {}),
                ...(planLimits ? { limits: planLimits } : {})
            });
            const summary = this.buildPlanSummary({ response, request });
            const guidance = this.buildGuidance(response?.guidance, nextCalls);
            const draftPackId = response?.draftPack?.id;
            const planApplyToken = typeof response?.applyToken === "string" ? response.applyToken : undefined;
            const applyTokenExpiresAt = typeof response?.applyTokenExpiresAt === "number" ? response.applyTokenExpiresAt : undefined;
            const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
            if (draftPackId) {
                artifacts.push({ id: draftPackId, kind: "draft", detail: "summary" });
            }
            if (response?.review?.id) {
                artifacts.push({ id: response.review.id, kind: "review", detail: "summary" });
            }
            if (response?.postReview?.id) {
                artifacts.push({ id: response.postReview.id, kind: "review", detail: "summary" });
            }
            return {
                ok: true,
                sessionId: response?.sessionId ?? sessionId,
                status: this.mapStatus(response),
                mode: routing.mode,
                budget,
                surface,
                summary: outputFormat === "summary" ? summary : summary,
                ...(draftPackId ? { draftId: draftPackId } : {}),
                ...(planApplyToken ? { applyToken: planApplyToken } : {}),
                ...(applyTokenExpiresAt ? { applyTokenExpiresAt } : {}),
                ...(artifacts.length > 0 ? { artifacts } : {}),
                ...(response?.degraded !== undefined ? { degraded: response.degraded } : {}),
                ...(response?.degradedReasons ? { degradedReasons: response.degradedReasons } : {}),
                ...(guidance ? { guidance } : {}),
                stats: {
                    latencyMs: Date.now() - startedAt
                }
            };
        }

        if (routing.mode === "apply_change") {
            const applyTargets = targetFiles.length > 0 ? targetFiles : (paths.length > 0 ? paths : []);
            const applyLimits = maxTokens ? { maxTokens } : undefined;
            const response = await this.context.orchestrationEngine.executePillar("change", {
                intent: request,
                targetFiles: applyTargets.length > 0 ? applyTargets : undefined,
                ...(edits.length > 0 ? { edits } : {}),
                sessionId,
                profile,
                safety: "apply",
                trace: traceEnabled,
                ...(typeof args?.refinement === "string" ? { refinement: args.refinement } : {}),
                ...(draftId ? { draftId } : {}),
                ...(applyToken ? { applyToken } : {}),
                ...(applyLimits ? { limits: applyLimits } : {})
            });
            const summary = this.buildApplySummary({ response, request });
            const guidance = this.buildGuidance(response?.guidance, nextCalls);
            const autoRepair = await this.attemptAutoRepair({
                response,
                sessionId: response?.sessionId ?? sessionId,
                profile,
                maxTokens,
                budget,
                targetFiles: applyTargets,
                paths
            });
            const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
            if (response?.review?.id) {
                artifacts.push({ id: response.review.id, kind: "review", detail: "summary" });
            }
            if (response?.postReview?.id) {
                artifacts.push({ id: response.postReview.id, kind: "review", detail: "summary" });
            }
            return {
                ok: true,
                sessionId: response?.sessionId ?? sessionId,
                status: this.mapStatus(response),
                mode: routing.mode,
                budget,
                surface,
                summary: outputFormat === "summary" ? summary : summary,
                ...(draftId ? { draftId } : {}),
                ...(artifacts.length > 0 ? { artifacts } : {}),
                ...(response?.degraded !== undefined ? { degraded: response.degraded } : {}),
                ...(response?.degradedReasons ? { degradedReasons: response.degradedReasons } : {}),
                ...(guidance ? { guidance } : {}),
                ...(autoRepair ? { autoRepair } : {}),
                stats: {
                    latencyMs: Date.now() - startedAt
                }
            };
        }

        if (routing.mode === "write" || routing.mode === "verify") {
            return {
                ok: true,
                sessionId: sessionId ?? "unknown",
                status: "blocked",
                mode: routing.mode,
                budget,
                surface,
                summary: {
                    title: `Mode "${routing.mode}" is not available in this phase.`,
                    bullets: ["Use plan_change to generate a draft before applying or writing."],
                    next: ["Call task with mode=plan_change and edits."]
                },
                guidance: nextCalls ? { nextCalls } : undefined,
                stats: {
                    latencyMs: Date.now() - startedAt
                }
            };
        }

        const response = await this.context.orchestrationEngine.executePillar("explore", {
            query: request,
            paths: paths.length > 0 ? paths : undefined,
            targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
            sessionId,
            profile,
            view: "preview",
            trace: traceEnabled,
            limits: maxTokens ? { maxTokens } : undefined
        });
        const summary = this.buildExploreSummary({ response, request, routingNote });
        const guidance = this.buildGuidance(response?.guidance, nextCalls);
        const packId = response?.pack?.packId ?? response?.researchPack?.id;
        return {
            ok: true,
            sessionId: response?.sessionId ?? sessionId,
            status: this.mapStatus(response),
            mode: routing.mode,
            budget,
            surface,
            summary: outputFormat === "summary" ? summary : summary,
            ...(packId ? { packId } : {}),
            ...(response?.degraded !== undefined ? { degraded: response.degraded } : {}),
            ...(response?.degradedReasons ? { degradedReasons: response.degradedReasons } : {}),
            ...(guidance ? { guidance } : {}),
            stats: {
                latencyMs: Date.now() - startedAt
            }
        };
    }
}
