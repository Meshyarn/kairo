import type { ExploreResponse } from "./ResultFormatter.js";
import { buildDegradedReasons } from "../../DegradedReasonMapper.js";
import { enforceExploreResponseBudget } from "../../budget/ResponseEnvelopeBudgeter.js";
import type { ExploreExecutionSetup } from "./ExplorePillarExecutionSetup.js";
import type { ExploreExecutionState } from "./ExplorePillarExecutionState.js";

export function finalizeExploreResponse(args: {
    setup: ExploreExecutionSetup;
    state: ExploreExecutionState;
    response: ExploreResponse;
}): void {
    const { setup, state, response } = args;

    if (response.data.docs.length === 0 && response.data.code.length === 0 && (!response.clusters || response.clusters.length === 0)) {
        response.status = "no_results";
        response.message = "No results found.";
    }

    if (state.budgetState.budgetExceeded) {
        state.degraded = true;
        state.reasons.push("budget_exceeded");
        response.compression = {
            applied: true,
            mode: state.budgetState.compressionDecisions.length > 0 ? "distill" : "truncate",
            elasticWindowPct: setup.maxTokens ? 0.05 : undefined,
            maxTokens: setup.maxTokens,
            estimatedTokens: state.budgetState.compressionEstimatedTokens > 0 ? state.budgetState.compressionEstimatedTokens : undefined,
            maxChars: setup.maxChars,
            usedChars: state.budgetState.compressionUsedChars > 0 ? state.budgetState.compressionUsedChars : undefined,
            decisions: state.budgetState.compressionDecisions.length > 0 ? state.budgetState.compressionDecisions : undefined
        };
    }

    if (state.degraded) {
        response.degraded = true;
        response.reasons = Array.from(new Set(state.reasons));
        response.degradedReasons = buildDegradedReasons(response.reasons);
    }

    enforceExploreResponseBudget({
        response,
        maxTokens: setup.maxTokens,
        maxChars: setup.maxChars,
        traceBuilder: setup.traceBuilder
    });

    if (setup.input.traceEnabled) {
        response.effectiveOptions = {
            version: 1,
            pillar: "explore",
            profile: setup.profile,
            sources: setup.input.resolvedOptions.effective.sources,
            include: setup.input.include,
            limits: setup.input.limits,
            view: setup.view
        };
        if (setup.traceBuilder) {
            setup.traceBuilder.setBudget({
                maxTokens: setup.maxTokens,
                maxChars: setup.maxChars,
                timeoutMs: setup.timeoutMs,
                compressionApplied: response.compression?.applied,
                compressionMode: response.compression?.mode === "none" ? undefined : response.compression?.mode
            });
            response.decisionTrace = setup.traceBuilder.finalize();
        }
    }
}
