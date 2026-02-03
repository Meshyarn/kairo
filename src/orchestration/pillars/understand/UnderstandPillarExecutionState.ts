import type { TraceBuilder } from "../../trace/TraceBuilder.js";

export interface UnderstandExecutionState {
  degraded: boolean;
  degradedReasons: string[];
  refinementReason?: string;
}

export function createUnderstandExecutionState(args: {
  budgetOmissions: Array<"dependencies" | "call_graph" | "hot_spots" | "analysis_pack" | "style_pack">;
  traceBuilder?: TraceBuilder;
}): UnderstandExecutionState {
  const { budgetOmissions, traceBuilder } = args;
  const state: UnderstandExecutionState = {
    degraded: false,
    degradedReasons: [],
    refinementReason: undefined
  };
  if (budgetOmissions.length > 0) {
    state.degraded = true;
    if (!state.degradedReasons.includes("budget_exceeded")) {
      state.degradedReasons.push("budget_exceeded");
    }
    state.refinementReason = state.refinementReason ?? "budget_exceeded";
    if (traceBuilder) {
      for (const section of budgetOmissions) {
        traceBuilder.recordEvent({
          area: "budget",
          code: "allocator.section_omit",
          data: { section }
        });
      }
    }
  }
  return state;
}
