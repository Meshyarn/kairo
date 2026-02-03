import type { TaskBudget } from "../../orchestration/policy/McpModePresetRegistry.js";

const buildNextCallsFromDegradedReasons = (
    degradedReasons?: Array<{ actionToolCall?: { tool: string; args: Record<string, unknown> }; actionId?: string; message?: string; type?: string }>
): Array<{ tool: string; args: Record<string, unknown>; reason?: string }> => {
    if (!Array.isArray(degradedReasons) || degradedReasons.length === 0) return [];
    const nextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = [];
    const seen = new Set<string>();
    for (const reason of degradedReasons) {
        const toolCall = reason?.actionToolCall;
        if (!toolCall?.tool || !toolCall?.args) continue;
        const key = reason.actionId ?? `${toolCall.tool}:${JSON.stringify(toolCall.args)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        nextCalls.push({
            tool: toolCall.tool,
            args: toolCall.args,
            reason: reason.message ?? reason.type
        });
    }
    return nextCalls;
};

export const buildGuidance = (
    guidance: any,
    nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }>,
    degradedReasons?: Array<{ actionToolCall?: { tool: string; args: Record<string, unknown> }; actionId?: string; message?: string; type?: string }>
) => {
    const degradedNextCalls = buildNextCallsFromDegradedReasons(degradedReasons);
    const next = [
        ...(nextCalls && nextCalls.length > 0 ? nextCalls : (guidance?.nextCalls ?? [])),
        ...degradedNextCalls
    ];
    if (!guidance && next.length === 0) return undefined;
    return {
        ...guidance,
        ...(next.length > 0 ? { nextCalls: next } : {})
    };
};

export const applyTaskDefaults = (
    args: Record<string, unknown>,
    defaults: { budget: TaskBudget; output?: any; traceEnabled: boolean; sessionId?: string }
): Record<string, unknown> => {
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
};

export const filterTaskArgs = (args: Record<string, unknown>): Record<string, unknown> => {
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
};

export const rewriteToolCallForCompact = (
    toolCall: any,
    defaults: { request: string; budget: TaskBudget; output?: any; traceEnabled: boolean; sessionId?: string }
): { tool: string; args: Record<string, unknown> } | undefined => {
    if (!toolCall || typeof toolCall.tool !== "string") return undefined;
    const tool = toolCall.tool;
    const toolArgs = (toolCall.args && typeof toolCall.args === "object") ? toolCall.args : {};
    if (tool === "manage") {
        return { tool, args: toolArgs };
    }
    if (tool === "task") {
        const merged = applyTaskDefaults({ ...toolArgs }, defaults);
        return { tool, args: filterTaskArgs(merged) };
    }
    if (tool === "change") {
        const safety = toolArgs.safety === "apply" ? "apply" : "plan";
        const mode = safety === "apply" ? "apply_change" : "plan_change";
        const targetFiles = Array.isArray(toolArgs.targetFiles) ? toolArgs.targetFiles
            : (typeof toolArgs.target === "string" ? [toolArgs.target]
                : (typeof toolArgs.targetPath === "string" ? [toolArgs.targetPath] : undefined));
        const merged = applyTaskDefaults(
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
        return { tool: "task", args: filterTaskArgs(merged) };
    }
    if (tool === "write") {
        const safety = toolArgs.safety === "apply" || toolArgs.dryRun === false ? "apply" : "plan";
        const targetFiles = typeof toolArgs.targetPath === "string"
            ? [toolArgs.targetPath]
            : (Array.isArray(toolArgs.targetFiles)
                ? toolArgs.targetFiles
                : (typeof toolArgs.target === "string" ? [toolArgs.target] : undefined));
        const merged = applyTaskDefaults(
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
        return { tool: "task", args: filterTaskArgs(merged) };
    }
    return undefined;
};

export const rewriteGuidanceForCompact = (args: {
    guidance?: any;
    request: string;
    budget: TaskBudget;
    output?: any;
    traceEnabled: boolean;
    sessionId?: string;
    surface: string;
}): any | undefined => {
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
                const updatedToolCall = rewriteToolCallForCompact(action?.toolCall, defaults);
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
                const updatedToolCall = rewriteToolCallForCompact({ tool: nextCall.tool, args: nextCall.args }, defaults);
                if (!updatedToolCall) return null;
                if (updatedToolCall.tool === nextCall.tool && updatedToolCall.args === nextCall.args) {
                    return nextCall;
                }
                return { tool: updatedToolCall.tool, args: updatedToolCall.args, reason: nextCall.reason };
            })
            .filter(Boolean);
        if (updatedNext.length > 0) {
            rewritten.nextCalls = updatedNext;
        } else {
            delete rewritten.nextCalls;
        }
    }
    return rewritten;
};

export const buildEvidenceContinuation = (args: {
    reason: string;
    nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }>;
    defaults: { request: string; budget: TaskBudget; output?: any; traceEnabled: boolean; sessionId?: string };
}): { reason: string; nextCalls: Array<{ tool: "task" | "manage"; args: Record<string, unknown> }> } | undefined => {
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
            const rewritten = rewriteToolCallForCompact({ tool: nextCall.tool, args: nextCall.args }, args.defaults);
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
};

export const buildNextCalls = (args: {
    category?: string;
    request: string;
    targetFiles: string[];
}): Array<{ tool: string; args: Record<string, unknown>; reason?: string }> | undefined => {
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
};

export const mapStatus = (response: any): "success" | "partial_success" | "blocked" => {
    const status = response?.status;
    if (status === "partial_success") return "partial_success";
    if (status === "blocked" || response?.success === false) return "blocked";
    return "success";
};
