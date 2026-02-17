import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { IntentRouter } from "../orchestration/IntentRouter.js";
import { TraceBuilder } from "../orchestration/trace/TraceBuilder.js";
import { resolveAutopilotPolicy, resolvePublicSurface, resolveTaskBudgetPolicy } from "../orchestration/policy/McpModePresetRegistry.js";
import {
    normalizeMode,
    normalizeBudget,
    normalizeProfile,
    normalizeDepthAlias,
    resolveBudgetFromProfile,
    normalizeSafety,
    resolveRoutingMode,
    extractPaths,
    extractEdits,
    extractMaxTokens,
    extractMaxChars,
    extractPillarOptions
} from "./task/TaskRoutingUtils.js";
import { buildNextCalls } from "./task/TaskGuidanceUtils.js";
import { handleAnalyze } from "./task/TaskExecutionAnalyze.js";
import { handlePlanChange } from "./task/TaskExecutionPlanChange.js";
import { handleApplyChange } from "./task/TaskExecutionApplyChange.js";
import { handleWrite } from "./task/TaskExecutionWrite.js";
import { handleVerify } from "./task/TaskExecutionVerify.js";
import { handleFallback } from "./task/TaskExecutionFallback.js";
import type { TaskExecutionState } from "./task/TaskExecutionState.js";

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

    private async executeTask(args: any) {
        const startedAt = Date.now();
        const request = typeof args?.request === "string" ? args.request.trim() : "";
        const mode = normalizeMode(args?.mode);
        const safety = normalizeSafety(args?.safety);
        const depthAliasProfile = normalizeDepthAlias(args?.depth);
        const requestedProfile = typeof args?.profile === "string"
            ? args.profile
            : (depthAliasProfile ?? args?.budget);
        const profile = normalizeProfile(requestedProfile);
        const budget = typeof args?.budget === "string" && requestedProfile === args?.budget
            ? normalizeBudget(args?.budget)
            : resolveBudgetFromProfile(profile);
        const pillarOptions = extractPillarOptions(args?.pillarOptions);
        const autopilotPolicy = resolveAutopilotPolicy();
        const requestedFormat = args?.output?.format;
        const outputFormat = requestedFormat === "summary" || requestedFormat === "standard"
            ? requestedFormat
            : autopilotPolicy.defaultOutputFormat;
        const outputPayload = args?.output && typeof args.output === "object" ? args.output : undefined;
        const maxTokens = extractMaxTokens(args?.output);
        const maxChars = extractMaxChars(args?.output);
        const responseLimits = maxTokens || maxChars ? { maxTokens, maxChars } : undefined;
        const sessionId = typeof args?.sessionId === "string" ? args.sessionId : undefined;
        const draftId = typeof args?.draftId === "string" ? args.draftId : undefined;
        const applyToken = typeof args?.applyToken === "string" ? args.applyToken : undefined;
        const paths = extractPaths(args?.paths);
        const targetFiles = extractPaths(args?.targetFiles);
        const targetPath = typeof args?.targetPath === "string" && args.targetPath.length > 0 ? args.targetPath : undefined;
        const edits = extractEdits(args?.edits);
        const traceEnabled = args?.trace === true;
        const surface = resolvePublicSurface();
        const budgetPolicy = resolveTaskBudgetPolicy(budget);
        const traceBuilder = traceEnabled
            ? new TraceBuilder(
                "task",
                {
                    profile: {
                        source: typeof requestedProfile === "string" ? "explicit" : "default",
                        explicit: typeof requestedProfile === "string",
                        resolved: profile,
                        requested: requestedProfile,
                        note: "task profile"
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

        const state: TaskExecutionState = {
            context: this.context,
            args,
            request,
            mode,
            budget,
            safety,
            profile,
            pillarOptions,
            autopilotPolicy,
            outputFormat,
            outputPayload,
            maxTokens,
            maxChars,
            responseLimits,
            sessionId,
            draftId,
            applyToken,
            paths,
            targetFiles,
            targetPath,
            edits,
            traceEnabled,
            surface,
            budgetPolicy,
            traceBuilder,
            startedAt,
            routing: undefined,
            routingNote: undefined,
            nextCalls: undefined,
            stepCount: 0,
            executePillar: async (pillar: string, payload: Record<string, unknown>) => {
                state.stepCount += 1;
                return this.context.orchestrationEngine.executePillar(pillar, payload);
            }
        };

        const routing = resolveRoutingMode(this.intentRouter, mode, request);
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
        const nextCalls = buildNextCalls({
            category: routing.category,
            request,
            targetFiles: targetFiles.length > 0 ? targetFiles : (targetPath ? [targetPath] : [])
        });

        state.routing = routing;
        state.routingNote = routingNote;
        state.nextCalls = nextCalls;

        switch (routing.mode) {
            case "analyze":
                return handleAnalyze(state);
            case "plan_change":
                return handlePlanChange(state);
            case "apply_change":
                return handleApplyChange(state);
            case "write":
                return handleWrite(state);
            case "verify":
                return handleVerify(state);
            default:
                return handleFallback(state);
        }
    }
}
