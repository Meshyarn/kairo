# ADR-030: Agent-Centric Adaptive Intelligence and Resilience (Historical)

**Status:** Implemented (2025-12-19)

## Context

Even with strong primitives (search/skeleton/edit), agents struggled with:

- “Skeleton blindness” (structure without side-effects/calls).
- “Edit risk blindness” (syntax checks don’t predict graph-wide breakage).
- Fragility in broken states (missing files, parse errors, inconsistent dependencies).

## Decision

Document and implement a tiered adaptive intelligence system:

- **Tier 1:** workflow guidance + recovery strategies; adaptive query intent; transaction-based edit
  safety; performance optimization; relationship tracking.
- **Tier 2:** semantic skeleton summaries (hidden calls/refs) and predictive impact analysis with
  risk scoring.
- **Tier 3:** advanced recovery (“ghost interface” reconstruction from usage patterns).

## Consequences

Shifts the product from “tools only” to “agent-oriented workflows”: token-aware, resilient to
partial/broken states, and capable of pre-change risk estimation.

