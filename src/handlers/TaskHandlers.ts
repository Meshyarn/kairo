import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { IntentRouter } from "../orchestration/IntentRouter.js";
import type { ExploreResponse } from "../orchestration/pillars/explore/ResultFormatter.js";
import { resolvePublicSurface } from "../orchestration/policy/McpModePresetRegistry.js";

type TaskMode = "auto" | "ask" | "analyze" | "plan_change" | "apply_change" | "write" | "verify";
type TaskBudget = "lean" | "balanced" | "deep";
type TaskProfile = "lean" | "fast" | "balanced" | "deep";

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

    private async executeTask(args: any) {
        const startedAt = Date.now();
        const request = typeof args?.request === "string" ? args.request.trim() : "";
        const mode = this.normalizeMode(args?.mode);
        const budget = this.normalizeBudget(args?.budget);
        const profile = this.resolveProfile(budget);
        const outputFormat = args?.output?.format === "standard" ? "standard" : "summary";
        const maxTokens = this.extractMaxTokens(args?.output);
        const sessionId = typeof args?.sessionId === "string" ? args.sessionId : undefined;
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
                ...(typeof args?.draftId === "string" ? { draftId: args.draftId } : {}),
                ...(planLimits ? { limits: planLimits } : {})
            });
            const summary = this.buildPlanSummary({ response, request });
            const guidance = this.buildGuidance(response?.guidance, nextCalls);
            const draftId = response?.draftPack?.id;
            const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
            if (draftId) {
                artifacts.push({ id: draftId, kind: "draft", detail: "summary" });
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
                ...(draftId ? { draftId } : {}),
                ...(artifacts.length > 0 ? { artifacts } : {}),
                ...(response?.degraded !== undefined ? { degraded: response.degraded } : {}),
                ...(response?.degradedReasons ? { degradedReasons: response.degradedReasons } : {}),
                ...(guidance ? { guidance } : {}),
                stats: {
                    latencyMs: Date.now() - startedAt
                }
            };
        }

        if (routing.mode === "apply_change" || routing.mode === "write" || routing.mode === "verify") {
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
