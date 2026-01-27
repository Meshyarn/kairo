# ADR-018: Consolidated Context-Aware Clustered Search (Historical)

**Status:** Proposed (consolidates ADR-017 + addendum)

## Context

ADR-017 introduced clustered search; ADR-017 addendum clarified how to keep cluster expansion
bounded and token-efficient.

## Decision

Consolidate clustered search into an implementation-ready contract:

- **ClusterSearchEngine** outputs relationship-aware clusters (not flat lists).
- **Explicit expansion state** per relationship group to support lazy loading and partial results.
- **Tiered previews** and limits so clusters remain usable under token budgets.
- **Caching/hot-spot precompute hooks** for expensive relationship expansions.

## Consequences

Defines a stable “clustered search” response shape that can be progressively expanded without
breaking agents or overflowing token budgets.

