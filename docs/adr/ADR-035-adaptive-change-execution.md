# ADR-035: Adaptive Change Execution (Safe-by-Default) (Historical)

**Status:** Proposed (2025-12-25)

## Context

`change` can become expensive when it always performs heavy analysis (impact graphs, multi-pass
matching, full diff generation), especially on low-quality requests.

## Decision

Adopt staged execution with budget caps and soft degradation:

- Stage 0: exact match fast path.
- Stage 1: normalization (budget-gated).
- Stage 2: fuzzy matching (tight guards).
- Stage 3: impact/graph analysis only on explicit opt-in.

When budgets are exceeded, return partial success + guidance instead of hard failures.

## Consequences

Improves latency and stability under worst-case agent behavior while keeping deep analysis
available when explicitly requested.

