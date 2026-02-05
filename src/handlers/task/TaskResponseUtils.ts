import { enforceTaskResponseBudget } from "../../orchestration/budget/ResponseEnvelopeBudgeter.js";
import type { TraceBuilder } from "../../orchestration/trace/TraceBuilder.js";
import type { TaskBudgetPolicy } from "../../orchestration/policy/McpModePresetRegistry.js";

export const finalizeTaskResponse = (args: {
    response: Record<string, any>;
    traceBuilder?: TraceBuilder;
    budgetPolicy: TaskBudgetPolicy;
    maxTokens?: number;
    maxChars?: number;
}) => {
    if (args.traceBuilder) {
        args.response.decisionTrace = args.traceBuilder.finalize();
    }
    const budgetResult = enforceTaskResponseBudget({
        response: args.response,
        maxTokens: args.maxTokens,
        maxChars: args.maxChars,
        traceBuilder: args.traceBuilder,
        minEvidenceItems: args.budgetPolicy.minEvidence,
        minExcerptChars: args.budgetPolicy.maxExcerptChars
    });
    if (budgetResult?.applied && !args.response.truncated) {
        args.response.truncated = true;
    }
    return args.response;
};
