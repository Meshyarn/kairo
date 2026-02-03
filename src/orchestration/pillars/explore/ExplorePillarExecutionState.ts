import { createExploreBudgetState } from "./ExploreDecisionEngine.js";

export type ExploreBudgetState = ReturnType<typeof createExploreBudgetState>;

export interface ExploreExecutionState {
    degraded: boolean;
    reasons: string[];
    totalChars: number;
    totalTokens: number;
    budgetState: ExploreBudgetState;
}

export function createExploreExecutionState(): ExploreExecutionState {
    return {
        degraded: false,
        reasons: [],
        totalChars: 0,
        totalTokens: 0,
        budgetState: createExploreBudgetState()
    };
}
