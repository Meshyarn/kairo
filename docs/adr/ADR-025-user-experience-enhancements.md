# ADR-025: UX Enhancements (Edits, Search, Skeleton, Batch Guidance) (Historical)

**Status:** Proposed (2025-12-13)

## Context

As usage matured from “surgical edits” to systematic refactors, friction concentrated in:

- Insert-style changes (before/after/at) being awkward with pure replace semantics.
- Search results needing better filtering/grouping for exploration.
- Skeleton views needing controllable detail (fields/comments/levels).
- Agents needing help recognizing “this pattern should be a batch edit”.

## Decision

Introduce complementary UX improvements (backward-compatible, opt-in):

- **Smart insert operations** (`insertBefore/After/At`) built on better anchoring and normalization.
- **Search refinement** (filtering, deduplication, grouping, preview control).
- **Skeleton view options** (what to include and at what detail level).
- **Batch edit guidance** (detect cross-file patterns and suggest batch operations).

## Consequences

Reduces “manual glue work” for agents and makes the common loop (find → read → change → coordinate)
more efficient.

