# ADR-074: Token Budget Allocator v2 + Summary Reuse

**Status:** Implemented (Phase A/B/C)

## Intent

- Standardize Explore/Understand budget allocation as a per-section plan to stabilize response size and structure.
- When budget is tight, prefer summarization/reuse strategies over hard truncation.
- Record allocator decisions (allocation/skip/summary selection) in `decisionTrace`.

## Progress

- Introduced TokenBudgetAllocator v2 (`src/orchestration/budget/TokenBudgetAllocatorV2.ts`).
- Generate a BudgetPlan in Explore/Understand and apply per-section strategies.
  - Explore document expansion switches between raw/preview/summary modes based on the plan.
  - Understand omits/summarizes graph/analysis/style sections based on the plan.
- Allocator decisions are recorded as `decisionTrace` events (`allocator.*`).
- Added allocator unit tests + allocator event allowlist tests.

## Implementation Status

- [x] Phase A: allocator + trace integration
- [x] Phase B: applied to Understand
- [x] Phase C: applied to Explore expansions
