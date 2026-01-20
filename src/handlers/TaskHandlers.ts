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
        return { mode: "ask" as TaskMode, category };
    }

    private extractPaths(value: any): string[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item) => typeof item === "string" && item.length > 0);
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
