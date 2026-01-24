import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { IntentRouter } from "../orchestration/IntentRouter.js";
import type { ExploreResponse } from "../orchestration/pillars/explore/ResultFormatter.js";
import { enforceTaskResponseBudget } from "../orchestration/budget/ResponseEnvelopeBudgeter.js";
import { TraceBuilder } from "../orchestration/trace/TraceBuilder.js";
import { resolveAutopilotPolicy, resolvePublicSurface, resolveTaskBudgetPolicy, type TaskBudget, type TaskBudgetPolicy } from "../orchestration/policy/McpModePresetRegistry.js";
import { buildDegradedReasons } from "../orchestration/DegradedReasonMapper.js";
import { buildEvidencePackFromExplore, buildEvidencePackFromUnderstand } from "../orchestration/task/TaskEvidenceBuilder.js";
import type { DegradedReason } from "../types/tool-responses.js";
import type { TaskEvidencePack } from "../types/flow-artifacts.js";
import { metrics } from "../utils/MetricsCollector.js";

type TaskMode = "auto" | "ask" | "analyze" | "plan_change" | "apply_change" | "write" | "verify";
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
type VerificationResult = {
    targetPath?: string;
    relPath?: string;
    exists: boolean;
    draftId?: string;
    draftFound?: boolean;
    contentMatch?: boolean;
    fileVersionMatch?: boolean;
};

const AUTO_REPAIR_REINDEX_PATH_LIMIT = 25;
const DEFAULT_TASK_EVIDENCE_TTL_MS = Number.parseInt(process.env.KAIRO_TASK_EVIDENCE_TTL_MS ?? "1800000", 10) || 1800000;

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

    private normalizeSafety(raw: any): "plan" | "apply" | undefined {
        if (raw === "plan" || raw === "apply") {
            return raw;
        }
        return undefined;
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
        if (category === "write") return { mode: "write" as TaskMode, category };
        return { mode: "ask" as TaskMode, category };
    }

    private resolveTargetPath(targetFiles: string[], paths: string[], targetPath?: string): string | undefined {
        if (targetFiles.length > 0) return targetFiles[0];
        if (targetPath) return targetPath;
        if (paths.length > 0) return paths[0];
        return undefined;
    }

    private extractContentFromRequest(request: string): string | undefined {
        if (!request) return undefined;
        const match = request.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
        if (!match) return undefined;
        return match[1].trimEnd();
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

    private extractMaxChars(value: any): number | undefined {
        const raw = value?.maxChars;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
        return parsed;
    }

    private mergeDegradedReasons(...sources: Array<DegradedReason[] | undefined>): DegradedReason[] | undefined {
        const combined = sources.flatMap((items) => items ?? []);
        if (combined.length === 0) return undefined;
        const seen = new Set<string>();
        const unique: DegradedReason[] = [];
        for (const entry of combined) {
            const key = `${entry.type}|${entry.filePath ?? ""}|${entry.message}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(entry);
        }
        return unique.length > 0 ? unique : undefined;
    }

    private buildExploreDecisionGate(args: {
        response: ExploreResponse;
        budgetPolicy: TaskBudgetPolicy;
        request: string;
        budget: TaskBudget;
        sessionId?: string;
        targetFiles: string[];
    }): { insufficient: boolean; reasons?: string[]; nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> } {
        const codeItems = Array.isArray(args.response?.data?.code) ? args.response.data.code : [];
        const docItems = Array.isArray(args.response?.data?.docs) ? args.response.data.docs : [];
        const targets = new Set<string>();
        for (const item of [...codeItems, ...docItems]) {
            if (typeof item?.filePath === "string") {
                targets.add(item.filePath);
            }
        }
        const evidenceCount = codeItems.length + docItems.length;
        const hasExplicitTarget = args.targetFiles.length > 0;
        const enoughTargets = hasExplicitTarget || targets.size >= args.budgetPolicy.minTargets;
        const enoughEvidence = evidenceCount >= args.budgetPolicy.minEvidence;
        const insufficient = !(enoughTargets && enoughEvidence);
        if (!insufficient) return { insufficient };

        const reasons = ["insufficient_evidence"];
        const topTarget = args.targetFiles[0]
            ?? codeItems[0]?.filePath
            ?? docItems[0]?.filePath;
        const nextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = [];
        if (topTarget) {
            nextCalls.push({
                tool: "task",
                args: {
                    request: args.request,
                    mode: "analyze",
                    budget: args.budget,
                    targetFiles: [topTarget],
                    sessionId: args.sessionId
                },
                reason: "Need deeper analysis of the top candidate file."
            });
        }
        return { insufficient, reasons, nextCalls };
    }

    private buildAnalyzeDecisionGate(args: {
        response: any;
        budgetPolicy: TaskBudgetPolicy;
        request: string;
        budget: TaskBudget;
        sessionId?: string;
        targetFiles: string[];
        paths: string[];
    }): { insufficient: boolean; reasons?: string[]; nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> } {
        const primaryFile = typeof args.response?.primaryFile === "string" ? args.response.primaryFile : "";
        const hasPrimary = primaryFile.length > 0 && primaryFile !== "unknown";
        if (hasPrimary) return { insufficient: false };

        const reasons = ["insufficient_evidence"];
        const nextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = [];
        if (args.targetFiles.length > 0 || args.paths.length > 0) {
            nextCalls.push({
                tool: "task",
                args: {
                    request: args.request,
                    mode: "ask",
                    budget: args.budget,
                    targetFiles: args.targetFiles.length > 0 ? args.targetFiles : undefined,
                    paths: args.paths.length > 0 ? args.paths : undefined,
                    sessionId: args.sessionId
                },
                reason: "Need more discovery signals before analysis."
            });
        }
        return { insufficient: true, reasons, nextCalls };
    }

    private finalizeTaskResponse(args: {
        response: Record<string, any>;
        traceBuilder?: TraceBuilder;
        budgetPolicy: TaskBudgetPolicy;
        maxTokens?: number;
        maxChars?: number;
    }) {
        if (args.traceBuilder) {
            args.response.decisionTrace = args.traceBuilder.finalize();
        }
        const budgetResult = enforceTaskResponseBudget({
            response: args.response,
            maxTokens: args.maxTokens,
            maxChars: args.maxChars,
            minEvidenceItems: args.budgetPolicy.minEvidence
        });
        metrics.observe("task.response.size_chars", budgetResult.usedChars, "basic");
        metrics.observe("task.response.estimated_tokens", budgetResult.estimatedTokens, "basic");
        if (budgetResult.applied) {
            metrics.inc("task.response_budget_exceeded_total", 1, "basic");
            args.traceBuilder?.recordEvent({
                area: "budget",
                code: "task.response_budget_exceeded",
                data: {
                    estimatedTokens: budgetResult.estimatedTokens,
                    usedChars: budgetResult.usedChars,
                    maxTokens: args.maxTokens,
                    maxChars: args.maxChars
                }
            });
        }
        return args.response;
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
                    safety: "plan",
                    ...(args.targetFiles[0] ? { targetPath: args.targetFiles[0] } : {})
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
        const status = response?.status ?? (response?.success === false ? "blocked" : "success");
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

    private buildInlineEvidence(args: {
        lod: number;
        evidencePack?: TaskEvidencePack;
    }): Array<{ filePath: string; reason?: string; excerpt?: string; kind?: string; source?: string; score?: number }> | undefined {
        const pack = args.evidencePack;
        if (!pack || args.lod <= 0) return undefined;
        if (args.lod === 1) {
            const ranked = Array.isArray(pack.rankedFiles) ? pack.rankedFiles : [];
            if (ranked.length === 0) return undefined;
            return ranked.map((item) => ({
                filePath: item.filePath,
                reason: item.reason,
                score: item.score
            }));
        }
        const evidence = Array.isArray(pack.evidence) ? pack.evidence : [];
        if (evidence.length === 0) return undefined;
        return evidence.map((item) => ({
            filePath: item.filePath,
            reason: item.reason,
            excerpt: item.excerpt,
            kind: item.kind,
            source: item.source,
            score: item.score
        }));
    }

    private buildTargetStringCandidates(args: {
        evidencePack?: TaskEvidencePack;
        maxCandidates: number;
    }): Array<{ filePath: string; anchorText: string; reason?: string; location?: { lineStart?: number; lineEnd?: number } }> | undefined {
        const pack = args.evidencePack;
        if (!pack) return undefined;
        const evidence = Array.isArray(pack.evidence) ? pack.evidence : [];
        const candidates = evidence
            .filter((item) => item.kind === "code" && typeof item.anchorText === "string" && item.anchorText.length > 0)
            .map((item) => ({
                filePath: item.filePath,
                anchorText: item.anchorText!,
                reason: item.reason,
                ...(item.location ? { location: item.location } : {})
            }))
            .slice(0, Math.max(0, args.maxCandidates));
        return candidates.length > 0 ? candidates : undefined;
    }

    private resolveTaskLod(args: {
        defaultLod: number;
        evidencePack?: TaskEvidencePack;
        hasEvidenceArtifact: boolean;
        decisionInsufficient?: boolean;
    }): { lod: number; reason?: string } {
        const rankedFiles = args.evidencePack?.rankedFiles ?? [];
        const evidenceItems = args.evidencePack?.evidence ?? [];
        let lod = args.defaultLod;
        let reason: string | undefined;
        if (rankedFiles.length === 0) {
            lod = 0;
            reason = "no_ranked_files";
        } else if (lod >= 2 && evidenceItems.length === 0) {
            lod = 1;
            reason = "no_evidence_items";
        } else if (lod >= 3 && !args.hasEvidenceArtifact) {
            lod = 2;
            reason = "no_evidence_artifact";
        }
        if (args.decisionInsufficient && lod === 0 && rankedFiles.length > 0) {
            lod = 1;
            reason = "force_min_evidence";
        }
        return { lod, reason };
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

    private recordTaskMetrics(args: {
        mode: TaskMode;
        budget: TaskBudget;
        stepCount: number;
        traceBuilder?: TraceBuilder;
        lod?: {
            defaultLod: number;
            resolvedLod: number;
            evidencePack?: TaskEvidencePack;
        };
    }): void {
        metrics.inc("task.request_total", 1, "basic");
        metrics.inc(`task.mode.${args.mode}.total`, 1, "basic");
        metrics.inc(`task.budget.${args.budget}.total`, 1, "basic");
        metrics.observe("task.steps.count", args.stepCount, "basic");
        metrics.observe(`task.steps.count.${args.mode}`, args.stepCount, "basic");
        if (args.lod) {
            metrics.gauge("task.lod.resolved", args.lod.resolvedLod, "basic");
            metrics.gauge(`task.lod.resolved.${args.mode}`, args.lod.resolvedLod, "basic");
            metrics.gauge(`task.lod.default.${args.mode}`, args.lod.defaultLod, "basic");
            if (args.lod.resolvedLod < args.lod.defaultLod) {
                metrics.inc("task.lod.downshift_total", 1, "basic");
                metrics.inc(`task.lod.downshift.${args.lod.defaultLod}_to_${args.lod.resolvedLod}`, 1, "basic");
            }
            const evidenceItems = args.lod.evidencePack?.evidence?.length ?? 0;
            const evidenceFiles = args.lod.evidencePack?.rankedFiles?.length ?? 0;
            metrics.observe("task.evidence.items", evidenceItems, "basic");
            metrics.observe("task.evidence.files", evidenceFiles, "basic");
        }
        args.traceBuilder?.recordEvent({
            area: "policy",
            code: "task.metrics",
            data: {
                mode: args.mode,
                budget: args.budget,
                stepCount: args.stepCount,
                ...(args.lod
                    ? {
                        defaultLod: args.lod.defaultLod,
                        resolvedLod: args.lod.resolvedLod,
                        evidenceItems: args.lod.evidencePack?.evidence?.length ?? 0,
                        evidenceFiles: args.lod.evidencePack?.rankedFiles?.length ?? 0
                    }
                    : {})
            }
        });
    }

    private storeEvidencePack(args: { pack: TaskEvidencePack; sessionId?: string; intent?: string }): string | undefined {
        const manager = this.context.flowArtifactManager;
        if (!manager) return undefined;
        const createdAt = typeof args.pack.createdAt === "number" ? args.pack.createdAt : Date.now();
        const expiresAt = typeof args.pack.expiresAt === "number"
            ? args.pack.expiresAt
            : createdAt + DEFAULT_TASK_EVIDENCE_TTL_MS;
        args.pack.createdAt = createdAt;
        args.pack.expiresAt = expiresAt;
        return manager.store({
            id: args.pack.id,
            type: "evidence",
            createdAt,
            expiresAt,
            pack: args.pack,
            sessionId: args.sessionId,
            metadata: args.intent ? { intent: args.intent } : undefined
        });
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

    private inferReplacementFromRequest(args: { request: string; targetString: string }): string | undefined {
        const request = String(args.request ?? "").replace(/\s+/g, " ").trim();
        if (!request) return undefined;
        const targetString = String(args.targetString ?? "");
        if (!targetString) return undefined;

        const patterns: RegExp[] = [
            /from\s+["'`]?(.+?)["'`]?\s+to\s+["'`]?(.+?)["'`]?(?:[.?!]|$)/i,
            /rename\s+["'`]?(.+?)["'`]?\s+to\s+["'`]?(.+?)["'`]?(?:[.?!]|$)/i,
            /replace\s+["'`]?(.+?)["'`]?\s+with\s+["'`]?(.+?)["'`]?(?:[.?!]|$)/i
        ];

        for (const pattern of patterns) {
            const match = request.match(pattern);
            if (!match) continue;
            const from = match[1]?.trim();
            const to = match[2]?.trim();
            if (!from || !to) continue;
            if (!targetString.includes(from)) continue;
            const replaced = targetString.replace(from, to);
            if (replaced !== targetString) {
                return replaced;
            }
        }
        return undefined;
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

    private buildWriteSummary(args: {
        response: any;
        request: string;
    }): { title: string; bullets: string[]; next: string[] } {
        const response = args.response ?? {};
        const targetFile = typeof response?.targetPath === "string"
            ? response.targetPath
            : (typeof response?.targetFile === "string" ? response.targetFile : (response?.createdFiles?.[0]?.path ?? "unknown"));
        const status = response?.status ?? (response?.success === false ? "blocked" : "success");
        const draftId = response?.draftPack?.id ?? "none";
        const createdCount = Array.isArray(response?.createdFiles) ? response.createdFiles.length : 0;
        const reviewId = response?.review?.id ?? response?.postReview?.id ?? "none";
        const bullets = [
            `Target: ${targetFile}.`,
            `Status: ${status}.`,
            `Draft: ${draftId}.`,
            `Created files: ${createdCount}.`
        ];
        const next: string[] = [];
        if (draftId !== "none") {
            next.push("Use manage artifact to review the draft pack.");
        }
        if (reviewId !== "none") {
            next.push("Use manage artifact to review the write review.");
        }
        return {
            title: `Write result for "${args.request}".`,
            bullets,
            next
        };
    }

    private buildVerifySummary(args: {
        request: string;
        verification: VerificationResult;
    }): { title: string; bullets: string[]; next: string[] } {
        const verification = args.verification;
        const target = verification.relPath ?? verification.targetPath ?? "unknown";
        const exists = verification.exists ? "yes" : "no";
        const contentMatch = verification.contentMatch === undefined
            ? "unknown"
            : (verification.contentMatch ? "match" : "mismatch");
        const versionMatch = verification.fileVersionMatch === undefined
            ? "unknown"
            : (verification.fileVersionMatch ? "match" : "mismatch");
        const bullets = [
            `Target: ${target}.`,
            `Exists: ${exists}.`,
            `Draft match: ${contentMatch}.`,
            `Base version: ${versionMatch}.`
        ];
        const next: string[] = [];
        if (verification.draftId && verification.draftFound) {
            next.push("Use manage artifact to review the draft pack.");
        }
        return {
            title: `Verify result for "${args.request}".`,
            bullets,
            next
        };
    }

    private applyTaskDefaults(
        args: Record<string, unknown>,
        defaults: { budget: TaskBudget; output?: any; traceEnabled: boolean; sessionId?: string }
    ): Record<string, unknown> {
        const next = { ...args };
        if (defaults.budget !== undefined && next.budget === undefined) {
            next.budget = defaults.budget;
        }
        if (defaults.output !== undefined && next.output === undefined) {
            next.output = defaults.output;
        }
        if (defaults.traceEnabled && next.trace === undefined) {
            next.trace = true;
        }
        if (defaults.sessionId && next.sessionId === undefined) {
            next.sessionId = defaults.sessionId;
        }
        return next;
    }

    private filterTaskArgs(args: Record<string, unknown>): Record<string, unknown> {
        const allowed = new Set([
            "request",
            "mode",
            "budget",
            "sessionId",
            "draftId",
            "applyToken",
            "refinement",
            "edits",
            "paths",
            "targetFiles",
            "targetPath",
            "safety",
            "output",
            "trace"
        ]);
        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
            if (!allowed.has(key) || value === undefined) continue;
            filtered[key] = value;
        }
        return filtered;
    }

    private rewriteToolCallForCompact(
        toolCall: any,
        defaults: { request: string; budget: TaskBudget; output?: any; traceEnabled: boolean; sessionId?: string }
    ): { tool: string; args: Record<string, unknown> } | undefined {
        if (!toolCall || typeof toolCall.tool !== "string") return undefined;
        const tool = toolCall.tool;
        const toolArgs = (toolCall.args && typeof toolCall.args === "object") ? toolCall.args : {};
        if (tool === "manage") {
            return { tool, args: toolArgs };
        }
        if (tool === "task") {
            const merged = this.applyTaskDefaults({ ...toolArgs }, defaults);
            return { tool, args: this.filterTaskArgs(merged) };
        }
        if (tool === "change") {
            const safety = toolArgs.safety === "apply" ? "apply" : "plan";
            const mode = safety === "apply" ? "apply_change" : "plan_change";
            const targetFiles = Array.isArray(toolArgs.targetFiles) ? toolArgs.targetFiles
                : (typeof toolArgs.target === "string" ? [toolArgs.target]
                    : (typeof toolArgs.targetPath === "string" ? [toolArgs.targetPath] : undefined));
            const merged = this.applyTaskDefaults(
                {
                    request: typeof toolArgs.intent === "string" ? toolArgs.intent : defaults.request,
                    mode,
                    targetFiles,
                    edits: toolArgs.edits,
                    draftId: toolArgs.draftId,
                    applyToken: toolArgs.applyToken,
                    sessionId: toolArgs.sessionId,
                    refinement: toolArgs.refinement,
                    safety: toolArgs.safety,
                    paths: toolArgs.paths
                },
                defaults
            );
            return { tool: "task", args: this.filterTaskArgs(merged) };
        }
        if (tool === "write") {
            const safety = toolArgs.safety === "apply" || toolArgs.dryRun === false ? "apply" : "plan";
            const targetFiles = typeof toolArgs.targetPath === "string"
                ? [toolArgs.targetPath]
                : (Array.isArray(toolArgs.targetFiles)
                    ? toolArgs.targetFiles
                    : (typeof toolArgs.target === "string" ? [toolArgs.target] : undefined));
            const merged = this.applyTaskDefaults(
                {
                    request: typeof toolArgs.intent === "string" ? toolArgs.intent : defaults.request,
                    mode: "write",
                    safety,
                    targetFiles,
                    draftId: toolArgs.draftId,
                    applyToken: toolArgs.applyToken,
                    sessionId: toolArgs.sessionId,
                    refinement: toolArgs.refinement
                },
                defaults
            );
            return { tool: "task", args: this.filterTaskArgs(merged) };
        }
        return undefined;
    }

    private rewriteGuidanceForCompact(args: {
        guidance?: any;
        request: string;
        budget: TaskBudget;
        output?: any;
        traceEnabled: boolean;
        sessionId?: string;
        surface: string;
    }): any | undefined {
        if (!args.guidance || args.surface !== "compact") return args.guidance;
        const defaults = {
            request: args.request,
            budget: args.budget,
            output: args.output,
            traceEnabled: args.traceEnabled,
            sessionId: args.sessionId
        };
        const rewritten: any = { ...args.guidance };
        if (Array.isArray(args.guidance.suggestedActions)) {
            const updated = args.guidance.suggestedActions
                .map((action: any) => {
                    if (!action?.toolCall) return action;
                    const updatedToolCall = this.rewriteToolCallForCompact(action?.toolCall, defaults);
                    if (!updatedToolCall) return null;
                    if (updatedToolCall === action?.toolCall) return action;
                    return { ...action, toolCall: updatedToolCall };
                })
                .filter(Boolean);
            if (updated.length > 0) {
                rewritten.suggestedActions = updated;
            } else {
                delete rewritten.suggestedActions;
            }
        }
        if (Array.isArray(args.guidance.nextCalls)) {
            const updatedNext = args.guidance.nextCalls
                .map((nextCall: any) => {
                    const updatedToolCall = this.rewriteToolCallForCompact({ tool: nextCall.tool, args: nextCall.args }, defaults);
                    if (!updatedToolCall) return null;
                    return { ...nextCall, tool: updatedToolCall.tool, args: updatedToolCall.args };
                })
                .filter(Boolean);
            if (updatedNext.length > 0) {
                rewritten.nextCalls = updatedNext;
            } else {
                delete rewritten.nextCalls;
            }
        }
        return rewritten;
    }

    private buildEvidenceContinuation(args: {
        reason: string;
        nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }>;
        defaults: { request: string; budget: TaskBudget; output?: any; traceEnabled: boolean; sessionId?: string };
    }): TaskEvidencePack["continuation"] | undefined {
        const nextCalls = Array.isArray(args.nextCalls) ? args.nextCalls : [];
        if (nextCalls.length === 0) return undefined;

        const normalized: Array<{ tool: "task" | "manage"; args: Record<string, unknown> }> = [];
        const seen = new Set<string>();
        for (const nextCall of nextCalls) {
            if (!nextCall || typeof nextCall.tool !== "string") continue;
            let tool: "task" | "manage" | undefined;
            let callArgs: Record<string, unknown> | undefined;

            if (nextCall.tool === "task" || nextCall.tool === "manage") {
                tool = nextCall.tool;
                callArgs = nextCall.args ?? {};
            } else {
                const rewritten = this.rewriteToolCallForCompact({ tool: nextCall.tool, args: nextCall.args }, args.defaults);
                if (rewritten?.tool === "task" || rewritten?.tool === "manage") {
                    tool = rewritten.tool;
                    callArgs = rewritten.args;
                }
            }

            if (!tool || !callArgs) continue;
            const key = `${tool}:${JSON.stringify(callArgs)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            normalized.push({ tool, args: callArgs });
            if (normalized.length >= 3) break;
        }

        if (normalized.length === 0) return undefined;
        return {
            reason: args.reason,
            nextCalls: normalized
        };
    }

    private async buildVerificationResult(args: {
        targetPath?: string;
        draftId?: string;
    }): Promise<{ verification: VerificationResult; reasons: string[] }> {
        const reasons: string[] = [];
        const verification: VerificationResult = {
            targetPath: args.targetPath,
            exists: false,
            draftId: args.draftId
        };
        if (!args.targetPath) {
            reasons.push("file_missing");
            return { verification, reasons };
        }
        const pathNormalizer = this.context.pathNormalizer;
        let relPath = args.targetPath;
        if (pathNormalizer) {
            try {
                relPath = pathNormalizer.normalize(args.targetPath);
            } catch {
                reasons.push("file_missing");
                return { verification, reasons };
            }
        }
        verification.relPath = relPath;
        const fileSystem = this.context.fileSystem;
        let fileContent: string | undefined;
        try {
            fileContent = await fileSystem.readFile(relPath);
            verification.exists = true;
        } catch {
            verification.exists = false;
            reasons.push("file_missing");
        }
        let draftPack: any;
        if (args.draftId) {
            const draftArtifact = this.context.flowArtifactManager?.get(args.draftId);
            draftPack = draftArtifact?.type === "draft" ? (draftArtifact as any).pack : undefined;
            verification.draftFound = Boolean(draftPack);
            if (!draftPack) {
                reasons.push("draft_missing");
            }
        }
        let draftContent: string | undefined;
        if (draftPack?.phantomFiles?.length) {
            const match = draftPack.phantomFiles.find((file: any) => {
                if (!file?.path) return false;
                if (!pathNormalizer) return file.path === relPath;
                try {
                    return pathNormalizer.normalize(file.path) === relPath;
                } catch {
                    return file.path === relPath;
                }
            });
            if (match && typeof match.content === "string") {
                draftContent = match.content;
            }
        }
        if (verification.exists && draftContent !== undefined) {
            verification.contentMatch = fileContent === draftContent;
            if (verification.contentMatch === false) {
                reasons.push("content_mismatch");
            }
        }
        const expectedVersion = draftPack?.fileVersions?.[relPath];
        const shouldCheckBaseVersion = verification.exists
            && verification.contentMatch !== true
            && expectedVersion
            && this.context.fileVersionManager
            && pathNormalizer;
        if (shouldCheckBaseVersion) {
            try {
                const absPath = pathNormalizer.toAbsolute(relPath);
                const currentVersion = await this.context.fileVersionManager!.getVersion(absPath);
                if (expectedVersion.expectedHash) {
                    verification.fileVersionMatch = currentVersion.contentHash === expectedVersion.expectedHash;
                } else if (expectedVersion.expectedVersion !== undefined) {
                    verification.fileVersionMatch = currentVersion.version === expectedVersion.expectedVersion;
                }
                if (verification.fileVersionMatch === false) {
                    reasons.push("file_version_mismatch");
                }
            } catch {
                // ignore version read failures
            }
        }
        return { verification, reasons };
    }

    private async executeTask(args: any) {
        const startedAt = Date.now();
        const request = typeof args?.request === "string" ? args.request.trim() : "";
        const mode = this.normalizeMode(args?.mode);
        const budget = this.normalizeBudget(args?.budget);
        const safety = this.normalizeSafety(args?.safety);
        const profile = this.resolveProfile(budget);
        const autopilotPolicy = resolveAutopilotPolicy();
        const requestedFormat = args?.output?.format;
        const outputFormat = requestedFormat === "summary" || requestedFormat === "standard"
            ? requestedFormat
            : autopilotPolicy.defaultOutputFormat;
        const outputPayload = args?.output && typeof args.output === "object" ? args.output : undefined;
        const maxTokens = this.extractMaxTokens(args?.output);
        const maxChars = this.extractMaxChars(args?.output);
        const responseLimits = maxTokens || maxChars ? { maxTokens, maxChars } : undefined;
        const sessionId = typeof args?.sessionId === "string" ? args.sessionId : undefined;
        const draftId = typeof args?.draftId === "string" ? args.draftId : undefined;
        const applyToken = typeof args?.applyToken === "string" ? args.applyToken : undefined;
        const paths = this.extractPaths(args?.paths);
        const targetFiles = this.extractPaths(args?.targetFiles);
        const targetPath = typeof args?.targetPath === "string" && args.targetPath.length > 0 ? args.targetPath : undefined;
        const edits = this.extractEdits(args?.edits);
        const traceEnabled = args?.trace === true;
        const surface = resolvePublicSurface();
        const budgetPolicy = resolveTaskBudgetPolicy(budget);
        const traceBuilder = traceEnabled
            ? new TraceBuilder(
                "task",
                {
                    profile: {
                        source: typeof args?.budget === "string" ? "explicit" : "default",
                        explicit: typeof args?.budget === "string",
                        resolved: budget,
                        requested: args?.budget,
                        note: "task budget"
                    },
                    safety: safety
                        ? {
                            source: "explicit",
                            explicit: true,
                            resolved: safety,
                            requested: args?.safety
                        }
                        : undefined,
                    trace: {
                        source: traceEnabled ? "explicit" : "default",
                        explicit: traceEnabled,
                        resolved: traceEnabled
                    }
                },
                { startedAtMs: startedAt }
            )
            : undefined;
        if (traceBuilder) {
            traceBuilder.recordEvent({
                area: "budget",
                code: "task.budget_policy",
                data: {
                    budget,
                    maxSteps: budgetPolicy.maxSteps,
                    minTargets: budgetPolicy.minTargets,
                    minEvidence: budgetPolicy.minEvidence
                }
            });
            traceBuilder.setBudget({ maxTokens, maxChars });
        }

        let stepCount = 0;
        const executePillar = async (pillar: string, payload: Record<string, unknown>) => {
            stepCount += 1;
            return this.context.orchestrationEngine.executePillar(pillar, payload);
        };

        const routing = this.resolveRoutingMode(mode, request);
        if (traceBuilder) {
            traceBuilder.recordEvent({
                area: "policy",
                code: "task.route",
                data: { mode: routing.mode, category: routing.category }
            });
        }
        const routingNote = routing.category === "change" || routing.category === "write" || routing.category === "manage"
            ? "Change/write/manage intent detected; returning read-only context."
            : undefined;
        const nextCalls = this.buildNextCalls({
            category: routing.category,
            request,
            targetFiles: targetFiles.length > 0 ? targetFiles : (targetPath ? [targetPath] : [])
        });

        if (routing.mode === "analyze") {
            const response = await executePillar("understand", {
                goal: request,
                targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
                sessionId,
                profile,
                trace: traceEnabled,
                limits: responseLimits
            });
            const relatedArtifacts = response?.callGraphArtifactId
                ? [{ id: response.callGraphArtifactId, kind: "call_graph", detail: "summary" as const }]
                : undefined;
            const summaryLine = typeof response?.summary === "string"
                ? response.summary
                : `Analysis for "${request}".`;
            const evidencePack = buildEvidencePackFromUnderstand({
                primaryFile: typeof response?.primaryFile === "string" ? response.primaryFile : undefined,
                summary: summaryLine,
                request,
                budgetPolicy,
                relatedArtifacts
            });
            const decisionGate = this.buildAnalyzeDecisionGate({
                response,
                budgetPolicy,
                request,
                budget,
                sessionId,
                targetFiles,
                paths
            });
            const combinedNextCalls = [
                ...(nextCalls ?? []),
                ...(decisionGate.nextCalls ?? [])
            ];
            const packDegradedReasons = this.mergeDegradedReasons(
                response?.degradedReasons,
                decisionGate.reasons ? buildDegradedReasons(decisionGate.reasons) : undefined
            );
            if (decisionGate.insufficient || response?.degraded !== undefined) {
                evidencePack.degraded = Boolean(response?.degraded) || decisionGate.insufficient;
            }
            if (packDegradedReasons) {
                evidencePack.degradedReasons = packDegradedReasons;
            }
            const continuation = decisionGate.insufficient
                ? this.buildEvidenceContinuation({
                    reason: "insufficient_evidence",
                    nextCalls: combinedNextCalls,
                    defaults: {
                        request,
                        budget,
                        output: outputPayload,
                        traceEnabled,
                        sessionId
                    }
                })
                : undefined;
            if (continuation) {
                evidencePack.continuation = continuation;
            }
            const lodResolution = this.resolveTaskLod({
                defaultLod: budgetPolicy.defaultLod,
                evidencePack,
                hasEvidenceArtifact: budgetPolicy.defaultLod >= 3,
                decisionInsufficient: decisionGate.insufficient
            });
            let evidenceArtifactId: string | undefined;
            if (lodResolution.lod >= 3) {
                evidenceArtifactId = this.storeEvidencePack({
                    pack: evidencePack,
                    sessionId: response?.sessionId ?? sessionId,
                    intent: request
                });
            }
            if (traceBuilder) {
                traceBuilder.recordEvent({
                    area: "policy",
                    code: "task.decision_gate",
                    data: {
                        mode: "analyze",
                        insufficient: decisionGate.insufficient
                    }
                });
                traceBuilder.recordEvent({
                    area: "policy",
                    code: "task.lod",
                    data: {
                        defaultLod: budgetPolicy.defaultLod,
                        resolvedLod: lodResolution.lod,
                        reason: lodResolution.reason
                    }
                });
            }
            const summary = this.buildUnderstandSummary({ response, request });
            if (decisionGate.insufficient) {
                summary.bullets.push("Decision gate: insufficient evidence; add explicit paths/targets or retry with follow-up guidance.");
            }
            const guidance = this.rewriteGuidanceForCompact({
                guidance: this.buildGuidance(response?.guidance, combinedNextCalls.length > 0 ? combinedNextCalls : undefined),
                request,
                budget,
                output: outputPayload,
                traceEnabled,
                sessionId,
                surface
            });
            const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
            if (response?.callGraphArtifactId) {
                artifacts.push({ id: response.callGraphArtifactId, kind: "call_graph", detail: "summary" });
            }
            if (evidenceArtifactId) {
                artifacts.push({ id: evidenceArtifactId, kind: "evidence", detail: "summary" });
            }
            const details = outputFormat === "standard" ? { pillar: "understand", response } : undefined;
            const degradedReasons = packDegradedReasons;
            const inlineEvidence = this.buildInlineEvidence({ lod: lodResolution.lod, evidencePack });
            const payload = {
                ok: true,
                sessionId: response?.sessionId ?? sessionId,
                status: decisionGate.insufficient ? "partial_success" : this.mapStatus(response),
                mode: routing.mode,
                budget,
                surface,
                summary,
                ...(inlineEvidence ? { evidence: inlineEvidence } : {}),
                ...(details ? { details } : {}),
                ...(artifacts.length > 0 ? { artifacts } : {}),
                ...(response?.degraded !== undefined || decisionGate.insufficient ? { degraded: Boolean(response?.degraded) || decisionGate.insufficient } : {}),
                ...(degradedReasons ? { degradedReasons } : {}),
                ...(guidance ? { guidance } : {}),
                stats: {
                    latencyMs: Date.now() - startedAt
                }
            };
            this.recordTaskMetrics({
                mode: routing.mode,
                budget,
                stepCount,
                traceBuilder,
                lod: {
                    defaultLod: budgetPolicy.defaultLod,
                    resolvedLod: lodResolution.lod,
                    evidencePack
                }
            });
            return this.finalizeTaskResponse({
                response: payload,
                traceBuilder,
                budgetPolicy,
                maxTokens,
                maxChars
            });
        }

        if (routing.mode === "plan_change") {
            const planTargets = targetFiles.length > 0
                ? targetFiles
                : (targetPath ? [targetPath] : (paths.length > 0 ? paths : []));
            const planLimits = responseLimits;
            if (edits.length === 0) {
                const response = await executePillar("explore", {
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
                const evidencePack = buildEvidencePackFromExplore({
                    response,
                    request,
                    budgetPolicy,
                    intentCategory: routing.category
                });
                const evidenceFileVersions = await this.buildFileVersionsSnapshot(
                    evidencePack.rankedFiles.map((item) => item.filePath)
                );
                if (evidenceFileVersions) {
                    evidencePack.fileVersions = evidenceFileVersions;
                }
                let targetStringCandidates = this.buildTargetStringCandidates({
                    evidencePack,
                    maxCandidates: Math.min(3, budgetPolicy.maxEvidenceItems)
                });
                if ((!targetStringCandidates || targetStringCandidates.length === 0) && budgetPolicy.maxSteps >= 2) {
                    const maxAnchorFiles = budget === "deep" ? 2 : 1;
                    const ranked = Array.isArray(evidencePack.rankedFiles) ? evidencePack.rankedFiles : [];
                    const anchorTargets = ranked
                        .map((item) => item.filePath)
                        .filter((filePath) => {
                            const lower = filePath.toLowerCase();
                            return !lower.endsWith(".md") && !lower.endsWith(".mdx");
                        })
                        .slice(0, maxAnchorFiles);
                    if (anchorTargets.length > 0) {
                        try {
                            const anchorResponse = await executePillar("explore", {
                                paths: anchorTargets,
                                sessionId,
                                profile: "lean",
                                view: "full",
                                trace: traceEnabled,
                                limits: { maxBytes: 200000, maxChars: 20000 }
                            });
                            const anchorPack = buildEvidencePackFromExplore({
                                response: anchorResponse,
                                request,
                                budgetPolicy,
                                intentCategory: routing.category
                            });
                            for (const item of anchorPack.evidence ?? []) {
                                if (item.kind !== "code" || typeof item.anchorText !== "string") continue;
                                const existing = evidencePack.evidence.find((entry) => entry.filePath === item.filePath && entry.kind === "code");
                                if (existing) {
                                    existing.anchorText = item.anchorText;
                                    existing.location = item.location;
                                }
                            }
                            const anchoredCandidates = this.buildTargetStringCandidates({
                                evidencePack: anchorPack,
                                maxCandidates: maxAnchorFiles
                            });
                            const merged = [
                                ...(anchoredCandidates ?? []),
                                ...(targetStringCandidates ?? [])
                            ];
                            if (merged.length > 0) {
                                const seen = new Set<string>();
                                targetStringCandidates = merged.filter((candidate) => {
                                    const key = `${candidate.filePath}:${candidate.anchorText}`;
                                    if (seen.has(key)) return false;
                                    seen.add(key);
                                    return true;
                                });
                            }
                        } catch {
                            // ignore anchor extraction failures
                        }
                    }
                }
                const lodResolution = this.resolveTaskLod({
                    defaultLod: budgetPolicy.defaultLod,
                    evidencePack,
                    hasEvidenceArtifact: budgetPolicy.defaultLod >= 3
                });
                let evidenceArtifactId: string | undefined;
                if (lodResolution.lod >= 3) {
                    evidenceArtifactId = this.storeEvidencePack({
                        pack: evidencePack,
                        sessionId: response?.sessionId ?? sessionId,
                        intent: request
                    });
                }
                if (traceBuilder) {
                    traceBuilder.recordEvent({
                        area: "policy",
                        code: "task.lod",
                        data: {
                            defaultLod: budgetPolicy.defaultLod,
                            resolvedLod: lodResolution.lod,
                            reason: lodResolution.reason
                        }
                    });
                }
                const summary = this.buildPlanPrepSummary({ request, recommendedTargets, packId });
                const prepNextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = [];
                const seededCandidate = Array.isArray(targetStringCandidates)
                    ? targetStringCandidates.find((candidate) => typeof candidate?.filePath === "string" && typeof candidate?.anchorText === "string")
                    : undefined;
                const seededTargetString = typeof seededCandidate?.anchorText === "string" ? seededCandidate.anchorText : undefined;
                const inferredReplacement = seededTargetString
                    ? this.inferReplacementFromRequest({ request, targetString: seededTargetString })
                    : undefined;
                const seededEdits = seededCandidate && seededTargetString
                    ? [{
                        filePath: seededCandidate.filePath,
                        targetString: seededTargetString,
                        replacementString: inferredReplacement ?? "<replacement>"
                    }]
                    : (Array.isArray((editsTemplate as any)?.edits) ? (editsTemplate as any).edits : undefined);
                if (Array.isArray(seededEdits) && seededEdits.length > 0) {
                    prepNextCalls.push({
                        tool: "task",
                        args: {
                            request,
                            mode: "plan_change",
                            budget,
                            sessionId: response?.sessionId ?? sessionId,
                            targetFiles: typeof seededCandidate?.filePath === "string"
                                ? [seededCandidate.filePath]
                                : (recommendedTargets.length > 0 ? [recommendedTargets[0]] : undefined),
                            edits: seededEdits,
                            ...(outputPayload ? { output: outputPayload } : {}),
                            ...(traceEnabled ? { trace: true } : {})
                        },
                        reason: inferredReplacement
                            ? "Attempt a best-effort plan based on the inferred replacement."
                            : "Draft a plan with an explicit edit (fill in the replacement if needed)."
                    });
                }
                if (packId) {
                    prepNextCalls.push({
                        tool: "manage",
                        args: { command: "artifact", target: packId, detail: "summary" },
                        reason: "Inspect the explore pack artifact."
                    });
                }
                const combinedNextCalls = [
                    ...prepNextCalls,
                    ...(Array.isArray(nextCalls) ? nextCalls : [])
                ];
                const guidance = this.rewriteGuidanceForCompact({
                    guidance: this.buildGuidance(response?.guidance, combinedNextCalls.length > 0 ? combinedNextCalls : undefined),
                    request,
                    budget,
                    output: outputPayload,
                    traceEnabled,
                    sessionId,
                    surface
                });
                const details = outputFormat === "standard" ? { pillar: "explore", response } : undefined;
                const inlineEvidence = this.buildInlineEvidence({ lod: lodResolution.lod, evidencePack });
                const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
                if (evidenceArtifactId) {
                    artifacts.push({ id: evidenceArtifactId, kind: "evidence", detail: "summary" });
                }
                const payload = {
                    ok: true,
                    sessionId: response?.sessionId ?? sessionId,
                    status: "partial_success",
                    mode: routing.mode,
                    budget,
                    surface,
                    summary,
                    ...(inlineEvidence ? { evidence: inlineEvidence } : {}),
                    ...(details ? { details } : {}),
                    ...(packId ? { packId } : {}),
                    changePrep: {
                        recommendedTargets,
                        ...(fileVersions ? { fileVersions } : {}),
                        editsTemplate,
                        ...(targetStringCandidates ? { targetStringCandidates } : {})
                    },
                    ...(artifacts.length > 0 ? { artifacts } : {}),
                    ...(response?.degraded !== undefined ? { degraded: response.degraded } : {}),
                    ...(response?.degradedReasons ? { degradedReasons: response.degradedReasons } : {}),
                    ...(guidance ? { guidance } : {}),
                    stats: {
                        latencyMs: Date.now() - startedAt
                    }
                };
                this.recordTaskMetrics({
                    mode: routing.mode,
                    budget,
                    stepCount,
                    traceBuilder,
                    lod: {
                        defaultLod: budgetPolicy.defaultLod,
                        resolvedLod: lodResolution.lod,
                        evidencePack
                    }
                });
                return this.finalizeTaskResponse({
                    response: payload,
                    traceBuilder,
                    budgetPolicy,
                    maxTokens,
                    maxChars
                });
            }

            const response = await executePillar("change", {
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
            const draftPackId = response?.draftPack?.id;
            const planApplyToken = typeof response?.applyToken === "string" ? response.applyToken : undefined;
            const applyTokenExpiresAt = typeof response?.applyTokenExpiresAt === "number" ? response.applyTokenExpiresAt : undefined;
            const effectiveSessionId = response?.sessionId ?? sessionId;
            const enhancedNextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = Array.isArray(nextCalls)
                ? [...nextCalls]
                : [];
            if (draftPackId && planApplyToken && effectiveSessionId) {
                enhancedNextCalls.unshift({
                    tool: "task",
                    args: {
                        request,
                        mode: "apply_change",
                        budget,
                        sessionId: effectiveSessionId,
                        draftId: draftPackId,
                        applyToken: planApplyToken,
                        ...(outputPayload ? { output: outputPayload } : {}),
                        ...(traceEnabled ? { trace: true } : {})
                    },
                    reason: "Apply the planned change."
                });
            }
            const guidance = this.rewriteGuidanceForCompact({
                guidance: this.buildGuidance(response?.guidance, enhancedNextCalls.length > 0 ? enhancedNextCalls : undefined),
                request,
                budget,
                output: outputPayload,
                traceEnabled,
                sessionId: effectiveSessionId,
                surface
            });
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
            const details = outputFormat === "standard" ? { pillar: "change", response } : undefined;
            const payload = {
                ok: true,
                sessionId: response?.sessionId ?? sessionId,
                status: this.mapStatus(response),
                mode: routing.mode,
                budget,
                surface,
                summary,
                ...(details ? { details } : {}),
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
            this.recordTaskMetrics({
                mode: routing.mode,
                budget,
                stepCount,
                traceBuilder
            });
            return this.finalizeTaskResponse({
                response: payload,
                traceBuilder,
                budgetPolicy,
                maxTokens,
                maxChars
            });
        }

        if (routing.mode === "apply_change") {
            const applyTargets = targetFiles.length > 0
                ? targetFiles
                : (targetPath ? [targetPath] : (paths.length > 0 ? paths : []));
            const applyLimits = responseLimits;
            const response = await executePillar("change", {
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
            let status = this.mapStatus(response);
            let verification: VerificationResult | undefined;
            let verificationReasons: string[] = [];
            const autoVerifyTargetPath = (typeof response?.targetFile === "string" ? response.targetFile : undefined)
                ?? (typeof response?.targetPath === "string" ? response.targetPath : undefined)
                ?? applyTargets[0];
            const autoVerifyDraftId = draftId;
            const canAutoVerify = status === "success"
                && budgetPolicy.maxSteps >= 2
                && Boolean(autoVerifyTargetPath)
                && Boolean(autoVerifyDraftId)
                && Boolean(this.context.fileSystem)
                && Boolean(this.context.flowArtifactManager);
            if (canAutoVerify) {
                const result = await this.buildVerificationResult({
                    targetPath: autoVerifyTargetPath,
                    draftId: autoVerifyDraftId
                });
                verification = result.verification;
                verificationReasons = result.reasons;
                summary.bullets.push(
                    `Auto-verify: exists=${verification.exists ? "yes" : "no"}, draftMatch=${verification.contentMatch === true ? "yes" : (verification.contentMatch === false ? "no" : "unknown")}.`
                );
                if (verificationReasons.length > 0 && status === "success") {
                    const isBlocked = verificationReasons.includes("file_missing") || verificationReasons.includes("draft_missing");
                    status = isBlocked ? "blocked" : "partial_success";
                }
            }
            const enhancedNextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = Array.isArray(nextCalls)
                ? [...nextCalls]
                : [];
            if (status !== "success") {
                enhancedNextCalls.unshift({
                    tool: "task",
                    args: {
                        request,
                        mode: "plan_change",
                        budget,
                        sessionId: response?.sessionId ?? sessionId,
                        ...(applyTargets.length > 0 ? { targetFiles: applyTargets } : {}),
                        ...(edits.length > 0 ? { edits } : {}),
                        ...(outputPayload ? { output: outputPayload } : {}),
                        ...(traceEnabled ? { trace: true } : {})
                    },
                    reason: "Re-plan to refresh tokens/file versions, then re-apply."
                });
            }
            const guidance = this.rewriteGuidanceForCompact({
                guidance: this.buildGuidance(response?.guidance, enhancedNextCalls.length > 0 ? enhancedNextCalls : undefined),
                request,
                budget,
                output: outputPayload,
                traceEnabled,
                sessionId,
                surface
            });
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
            const details = outputFormat === "standard" ? { pillar: "change", response } : undefined;
            const verifyDegradedReasons = verificationReasons.length > 0
                ? buildDegradedReasons(verificationReasons, { filePath: verification?.relPath ?? verification?.targetPath })
                : undefined;
            const degradedReasons = this.mergeDegradedReasons(response?.degradedReasons, verifyDegradedReasons);
            const degraded = Boolean(response?.degraded) || verificationReasons.length > 0;
            const payload = {
                ok: true,
                sessionId: response?.sessionId ?? sessionId,
                status,
                mode: routing.mode,
                budget,
                surface,
                summary,
                ...(details ? { details } : {}),
                ...(draftId ? { draftId } : {}),
                ...(artifacts.length > 0 ? { artifacts } : {}),
                ...(verification ? { verification } : {}),
                ...(response?.degraded !== undefined || verificationReasons.length > 0 ? { degraded } : {}),
                ...(degradedReasons ? { degradedReasons } : {}),
                ...(guidance ? { guidance } : {}),
                ...(autoRepair ? { autoRepair } : {}),
                stats: {
                    latencyMs: Date.now() - startedAt
                }
            };
            this.recordTaskMetrics({
                mode: routing.mode,
                budget,
                stepCount,
                traceBuilder
            });
            return this.finalizeTaskResponse({
                response: payload,
                traceBuilder,
                budgetPolicy,
                maxTokens,
                maxChars
            });
        }

        if (routing.mode === "write") {
            const writeSafety = safety ?? "plan";
            const writeTargetPath = this.resolveTargetPath(targetFiles, paths, targetPath);
            const extractedContent = writeSafety === "plan" ? this.extractContentFromRequest(request) : undefined;
            let prepEvidencePack: TaskEvidencePack | undefined;
            let prepEvidenceArtifactId: string | undefined;
            let prepLodResolution: { lod: number; reason?: string } | undefined;
            if (writeSafety === "plan" && extractedContent === undefined && budgetPolicy.maxSteps >= 2) {
                const exploreResponse = await executePillar("explore", {
                    query: request,
                    paths: paths.length > 0 ? paths : undefined,
                    targetFiles: writeTargetPath ? [writeTargetPath] : undefined,
                    sessionId,
                    profile,
                    view: "preview",
                    trace: traceEnabled,
                    limits: responseLimits
                });
                const relatedArtifacts = exploreResponse?.researchPack?.id
                    ? [{ id: exploreResponse.researchPack.id, kind: "research", detail: "summary" as const }]
                    : undefined;
                prepEvidencePack = buildEvidencePackFromExplore({
                    response: exploreResponse,
                    request,
                    budgetPolicy,
                    intentCategory: routing.category,
                    relatedArtifacts
                });
                prepLodResolution = this.resolveTaskLod({
                    defaultLod: budgetPolicy.defaultLod,
                    evidencePack: prepEvidencePack,
                    hasEvidenceArtifact: budgetPolicy.defaultLod >= 3
                });
                if (prepLodResolution.lod >= 3) {
                    const fileVersions = await this.buildFileVersionsSnapshot(
                        prepEvidencePack.rankedFiles.map((item) => item.filePath)
                    );
                    if (fileVersions) {
                        prepEvidencePack.fileVersions = fileVersions;
                    }
                    prepEvidenceArtifactId = this.storeEvidencePack({
                        pack: prepEvidencePack,
                        sessionId: exploreResponse?.sessionId ?? sessionId,
                        intent: request
                    });
                }
                if (traceBuilder) {
                    traceBuilder.recordEvent({
                        area: "policy",
                        code: "task.composite_flow",
                        data: {
                            steps: ["explore", "write"],
                            reason: "write_plan_prep"
                        }
                    });
                    traceBuilder.recordEvent({
                        area: "policy",
                        code: "task.lod",
                        data: {
                            defaultLod: budgetPolicy.defaultLod,
                            resolvedLod: prepLodResolution.lod,
                            reason: prepLodResolution.reason
                        }
                    });
                }
            }
            const response = await executePillar("write", {
                intent: request,
                targetPath: writeTargetPath,
                ...(extractedContent !== undefined ? { content: extractedContent } : {}),
                ...(extractedContent === undefined && writeSafety === "plan" ? { smartWrite: true } : {}),
                sessionId,
                profile,
                trace: traceEnabled,
                safety: writeSafety,
                ...(draftId ? { draftId } : {}),
                ...(applyToken ? { applyToken } : {}),
                ...(typeof args?.refinement === "string" ? { refinement: args.refinement } : {}),
                ...(responseLimits ? { limits: responseLimits } : {})
            });
            const summary = this.buildWriteSummary({ response, request });
            let status = this.mapStatus(response);
            let verification: VerificationResult | undefined;
            let verificationReasons: string[] = [];
            const writeDraftId = (typeof response?.draftPack?.id === "string" ? response.draftPack.id : undefined)
                ?? draftId;
            const autoVerifyTargetPath = (typeof response?.targetPath === "string" ? response.targetPath : undefined)
                ?? (typeof response?.targetFile === "string" ? response.targetFile : undefined)
                ?? (Array.isArray(response?.createdFiles) ? response.createdFiles[0]?.path : undefined)
                ?? writeTargetPath;
            const canAutoVerify = writeSafety === "apply"
                && status === "success"
                && budgetPolicy.maxSteps >= 2
                && Boolean(autoVerifyTargetPath)
                && Boolean(writeDraftId)
                && Boolean(this.context.fileSystem)
                && Boolean(this.context.flowArtifactManager);
            if (canAutoVerify) {
                const result = await this.buildVerificationResult({
                    targetPath: autoVerifyTargetPath,
                    draftId: writeDraftId
                });
                verification = result.verification;
                verificationReasons = result.reasons;
                summary.bullets.push(
                    `Auto-verify: exists=${verification.exists ? "yes" : "no"}, draftMatch=${verification.contentMatch === true ? "yes" : (verification.contentMatch === false ? "no" : "unknown")}.`
                );
                if (verificationReasons.length > 0 && status === "success") {
                    const isBlocked = verificationReasons.includes("file_missing") || verificationReasons.includes("draft_missing");
                    status = isBlocked ? "blocked" : "partial_success";
                }
            }
            const inlineEvidence = prepEvidencePack && prepLodResolution
                ? this.buildInlineEvidence({ lod: prepLodResolution.lod, evidencePack: prepEvidencePack })
                : undefined;
            if (inlineEvidence?.length) {
                summary.bullets.push("Prep evidence: similar files and snippets gathered for write planning.");
            }
            const draftPackId = response?.draftPack?.id;
            const writeApplyToken = typeof response?.applyToken === "string" ? response.applyToken : undefined;
            const applyTokenExpiresAt = typeof response?.applyTokenExpiresAt === "number" ? response.applyTokenExpiresAt : undefined;
            const effectiveSessionId = response?.sessionId ?? sessionId;
            const enhancedNextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = Array.isArray(nextCalls)
                ? [...nextCalls]
                : [];
            if (writeSafety === "plan" && draftPackId && writeApplyToken && effectiveSessionId) {
                enhancedNextCalls.unshift({
                    tool: "task",
                    args: {
                        request,
                        mode: "write",
                        safety: "apply",
                        budget,
                        sessionId: effectiveSessionId,
                        draftId: draftPackId,
                        applyToken: writeApplyToken,
                        ...(outputPayload ? { output: outputPayload } : {}),
                        ...(traceEnabled ? { trace: true } : {})
                    },
                    reason: "Apply the planned write."
                });
            }
            const guidance = this.rewriteGuidanceForCompact({
                guidance: this.buildGuidance(response?.guidance, enhancedNextCalls.length > 0 ? enhancedNextCalls : undefined),
                request,
                budget,
                output: outputPayload,
                traceEnabled,
                sessionId: effectiveSessionId,
                surface
            });
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
            if (prepEvidenceArtifactId) {
                artifacts.push({ id: prepEvidenceArtifactId, kind: "evidence", detail: "summary" });
            }
            const details = outputFormat === "standard" ? { pillar: "write", response } : undefined;
            const verifyDegradedReasons = verificationReasons.length > 0
                ? buildDegradedReasons(verificationReasons, { filePath: verification?.relPath ?? verification?.targetPath })
                : undefined;
            const degradedReasons = this.mergeDegradedReasons(response?.degradedReasons, verifyDegradedReasons);
            const degraded = Boolean(response?.degraded) || verificationReasons.length > 0;
            const payload = {
                ok: true,
                sessionId: response?.sessionId ?? sessionId,
                status,
                mode: routing.mode,
                budget,
                surface,
                summary,
                ...(inlineEvidence ? { evidence: inlineEvidence } : {}),
                ...(details ? { details } : {}),
                ...(draftPackId ? { draftId: draftPackId } : {}),
                ...(writeApplyToken ? { applyToken: writeApplyToken } : {}),
                ...(applyTokenExpiresAt ? { applyTokenExpiresAt } : {}),
                ...(artifacts.length > 0 ? { artifacts } : {}),
                ...(verification ? { verification } : {}),
                ...(response?.degraded !== undefined || verificationReasons.length > 0 ? { degraded } : {}),
                ...(degradedReasons ? { degradedReasons } : {}),
                ...(guidance ? { guidance } : {}),
                stats: {
                    latencyMs: Date.now() - startedAt
                }
            };
            this.recordTaskMetrics({
                mode: routing.mode,
                budget,
                stepCount,
                traceBuilder,
                ...(prepEvidencePack && prepLodResolution
                    ? {
                        lod: {
                            defaultLod: budgetPolicy.defaultLod,
                            resolvedLod: prepLodResolution.lod,
                            evidencePack: prepEvidencePack
                        }
                    }
                    : {})
            });
            return this.finalizeTaskResponse({
                response: payload,
                traceBuilder,
                budgetPolicy,
                maxTokens,
                maxChars
            });
        }

        if (routing.mode === "verify") {
            const verifyTargetPath = this.resolveTargetPath(targetFiles, paths, targetPath);
            const { verification, reasons } = await this.buildVerificationResult({ targetPath: verifyTargetPath, draftId });
            const degradedReasons = buildDegradedReasons(reasons, {
                filePath: verification.relPath ?? verification.targetPath
            });
            const isBlocked = reasons.includes("file_missing") || reasons.includes("draft_missing");
            const status = reasons.length === 0 ? "success" : (isBlocked ? "blocked" : "partial_success");
            const summary = this.buildVerifySummary({ request, verification });
            const guidance = this.rewriteGuidanceForCompact({
                guidance: this.buildGuidance(undefined, nextCalls),
                request,
                budget,
                output: outputPayload,
                traceEnabled,
                sessionId,
                surface
            });
            const payload = {
                ok: true,
                sessionId: sessionId ?? "unknown",
                status,
                mode: routing.mode,
                budget,
                surface,
                summary,
                verification,
                ...(reasons.length > 0 ? { degraded: true } : {}),
                ...(degradedReasons ? { degradedReasons } : {}),
                ...(guidance ? { guidance } : {}),
                stats: {
                    latencyMs: Date.now() - startedAt
                }
            };
            this.recordTaskMetrics({
                mode: routing.mode,
                budget,
                stepCount,
                traceBuilder
            });
            return this.finalizeTaskResponse({
                response: payload,
                traceBuilder,
                budgetPolicy,
                maxTokens,
                maxChars
            });
        }

        const response = await executePillar("explore", {
            query: request,
            paths: paths.length > 0 ? paths : undefined,
            targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
            sessionId,
            profile,
            view: "preview",
            trace: traceEnabled,
            limits: responseLimits
        });
        const exploreEvidencePack = buildEvidencePackFromExplore({
            response,
            request,
            budgetPolicy,
            intentCategory: routing.category
        });
        const relatedArtifacts = response?.researchPack?.id
            ? [{ id: response.researchPack.id, kind: "research", detail: "summary" as const }]
            : undefined;
        exploreEvidencePack.relatedArtifacts = relatedArtifacts ?? exploreEvidencePack.relatedArtifacts;
        const decisionGate = this.buildExploreDecisionGate({
            response,
            budgetPolicy,
            request,
            budget,
            sessionId,
            targetFiles
        });
        let understandResponse: any | undefined;
        let analyzeDecisionGate: { insufficient: boolean; reasons?: string[]; nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> } | undefined;
        const topTarget = targetFiles[0]
            ?? response?.data?.code?.[0]?.filePath
            ?? response?.data?.docs?.[0]?.filePath;
        if (decisionGate.insufficient && budgetPolicy.maxSteps >= 2 && topTarget) {
            understandResponse = await executePillar("understand", {
                goal: request,
                targetFiles: [topTarget],
                sessionId,
                profile,
                trace: traceEnabled,
                limits: responseLimits
            });
            analyzeDecisionGate = this.buildAnalyzeDecisionGate({
                response: understandResponse,
                budgetPolicy,
                request,
                budget,
                sessionId,
                targetFiles,
                paths
            });
        }
        if (traceBuilder) {
            traceBuilder.recordEvent({
                area: "policy",
                code: "task.decision_gate",
                data: {
                    mode: "ask",
                    insufficient: decisionGate.insufficient,
                    codeCount: response?.data?.code?.length ?? 0,
                    docCount: response?.data?.docs?.length ?? 0
                }
            });
            if (understandResponse) {
                traceBuilder.recordEvent({
                    area: "policy",
                    code: "task.composite_flow",
                    data: {
                        steps: ["explore", "understand"],
                        reason: "decision_gate_insufficient"
                    }
                });
            }
        }
        const summary = this.buildExploreSummary({ response, request, routingNote });
        if (decisionGate.insufficient) {
            summary.bullets.push("Decision gate: insufficient evidence; add explicit paths/targets or retry with follow-up guidance.");
            summary.next.push("Provide explicit paths/targetFiles to improve evidence quality.");
        }
        if (understandResponse) {
            const analysisLine = typeof understandResponse?.summary === "string"
                ? understandResponse.summary
                : (typeof understandResponse?.primaryFile === "string" ? `Primary file: ${understandResponse.primaryFile}.` : "Analysis completed.");
            summary.bullets.push(`Deep analysis: ${analysisLine}`);
        }
        const combinedNextCalls = [
            ...(nextCalls ?? []),
            ...(decisionGate.nextCalls ?? [])
        ];
        if (analyzeDecisionGate?.nextCalls?.length) {
            combinedNextCalls.push(...analyzeDecisionGate.nextCalls);
        }
        const degradedReasons = this.mergeDegradedReasons(
            response?.degradedReasons,
            decisionGate.reasons ? buildDegradedReasons(decisionGate.reasons) : undefined,
            analyzeDecisionGate?.reasons ? buildDegradedReasons(analyzeDecisionGate.reasons) : undefined
        );
        const decisionInsufficient = decisionGate.insufficient || analyzeDecisionGate?.insufficient;
        const guidance = this.rewriteGuidanceForCompact({
            guidance: this.buildGuidance(response?.guidance, combinedNextCalls.length > 0 ? combinedNextCalls : undefined),
            request,
            budget,
            output: outputPayload,
            traceEnabled,
            sessionId,
            surface
        });
        const packId = response?.pack?.packId ?? response?.researchPack?.id;
        const evidencePack = understandResponse
            ? (() => {
                const summaryLine = typeof understandResponse?.summary === "string"
                    ? understandResponse.summary
                    : `Analysis for "${request}".`;
                const analysisPack = buildEvidencePackFromUnderstand({
                    primaryFile: typeof understandResponse?.primaryFile === "string" ? understandResponse.primaryFile : undefined,
                    summary: summaryLine,
                    request,
                    budgetPolicy,
                    relatedArtifacts: understandResponse?.callGraphArtifactId
                        ? [{ id: understandResponse.callGraphArtifactId, kind: "call_graph", detail: "summary" }]
                        : undefined
                });
                return {
                    ...analysisPack,
                    rankedFiles: exploreEvidencePack.rankedFiles.length > 0 ? exploreEvidencePack.rankedFiles : analysisPack.rankedFiles,
                    evidence: [...analysisPack.evidence, ...exploreEvidencePack.evidence].slice(0, budgetPolicy.maxEvidenceItems),
                    relatedArtifacts: [
                        ...(analysisPack.relatedArtifacts ?? []),
                        ...(exploreEvidencePack.relatedArtifacts ?? [])
                    ]
                };
            })()
            : exploreEvidencePack;
        let evidenceArtifactId: string | undefined;
        if (degradedReasons) {
            evidencePack.degradedReasons = degradedReasons;
        }
        if (response?.degraded !== undefined || decisionInsufficient) {
            evidencePack.degraded = Boolean(response?.degraded) || Boolean(decisionInsufficient);
        }
        if (decisionInsufficient) {
            const continuation = this.buildEvidenceContinuation({
                reason: "insufficient_evidence",
                nextCalls: combinedNextCalls,
                defaults: {
                    request,
                    budget,
                    output: outputPayload,
                    traceEnabled,
                    sessionId
                }
            });
            if (continuation) {
                evidencePack.continuation = continuation;
            }
        }
        const lodResolution = this.resolveTaskLod({
            defaultLod: budgetPolicy.defaultLod,
            evidencePack,
            hasEvidenceArtifact: budgetPolicy.defaultLod >= 3,
            decisionInsufficient
        });
        if (lodResolution.lod >= 3) {
            const fileVersions = await this.buildFileVersionsSnapshot(
                evidencePack.rankedFiles.map((item) => item.filePath)
            );
            if (fileVersions) {
                evidencePack.fileVersions = fileVersions;
            }
            evidenceArtifactId = this.storeEvidencePack({
                pack: evidencePack,
                sessionId: understandResponse?.sessionId ?? response?.sessionId ?? sessionId,
                intent: request
            });
        }
        if (traceBuilder) {
            traceBuilder.recordEvent({
                area: "policy",
                code: "task.lod",
                data: {
                    defaultLod: budgetPolicy.defaultLod,
                    resolvedLod: lodResolution.lod,
                    reason: lodResolution.reason
                }
            });
        }
        const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
        if (understandResponse?.callGraphArtifactId) {
            artifacts.push({ id: understandResponse.callGraphArtifactId, kind: "call_graph", detail: "summary" });
        }
        if (evidenceArtifactId) {
            artifacts.push({ id: evidenceArtifactId, kind: "evidence", detail: "summary" });
        }
        const details = outputFormat === "standard"
            ? (understandResponse ? { pillar: "explore", response, followUp: { pillar: "understand", response: understandResponse } } : { pillar: "explore", response })
            : undefined;
        const inlineEvidence = this.buildInlineEvidence({ lod: lodResolution.lod, evidencePack });
        const payload = {
            ok: true,
            sessionId: understandResponse?.sessionId ?? response?.sessionId ?? sessionId,
            status: decisionInsufficient ? "partial_success" : this.mapStatus(understandResponse ?? response),
            mode: routing.mode,
            budget,
            surface,
            summary,
            ...(inlineEvidence ? { evidence: inlineEvidence } : {}),
            ...(details ? { details } : {}),
            ...(packId ? { packId } : {}),
            ...(artifacts.length > 0 ? { artifacts } : {}),
            ...(response?.degraded !== undefined || decisionInsufficient ? { degraded: Boolean(response?.degraded) || decisionInsufficient } : {}),
            ...(degradedReasons ? { degradedReasons } : {}),
            ...(guidance ? { guidance } : {}),
            stats: {
                latencyMs: Date.now() - startedAt
            }
        };
        this.recordTaskMetrics({
            mode: routing.mode,
            budget,
            stepCount,
            traceBuilder,
            lod: {
                defaultLod: budgetPolicy.defaultLod,
                resolvedLod: lodResolution.lod,
                evidencePack
            }
        });
        return this.finalizeTaskResponse({
            response: payload,
            traceBuilder,
            budgetPolicy,
            maxTokens,
            maxChars
        });
    }
}
