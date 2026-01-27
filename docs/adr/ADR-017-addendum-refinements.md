# ADR-017 Addendum: Lazy Expansion, Token Control & Caching Refinements (Historical)

**Status:** Proposed (addendum to ADR-017)

## Context

ADR-017 introduced clustered search, but three areas needed concrete implementation detail:

- Lazy relationship expansion (what is loaded now vs later).
- Token/cost control for previews.
- Caching strategy for expensive relationship queries.

## Decision

Refine the cluster contract and API:

- Replace vague “lazy” markers with an explicit **expansion state machine**
  (`not_loaded/loading/loaded/failed/truncated`) per relationship group.
- Add explicit tool parameters to choose which relationships to expand eagerly vs on-demand.
- Define preview generation limits and caching hooks so “expensive expansions” remain bounded and
  predictable.

## Consequences

Enables progressive disclosure for clustered search (cheap relations always available; expensive
relations fetched only when requested) while keeping responses within token budgets.

