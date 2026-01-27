# ADR-021: Enterprise-Grade Core Enhancements (Historical)

**Status:** Proposed (2024-12-11)

## Context

Project adoption exposed three architectural gaps:

- **Testability:** domain logic directly importing `fs` across many modules.
- **Search quality:** grep/BM25-style ranking missing semantic relevance and scaling poorly.
- **Diff quality:** Myers diffs obscure refactor intent (moves/renames look like churn).

## Decision

Define a roadmap around:

- A comprehensive `IFileSystem` boundary (sync/async ops + metadata + optional watch/batch).
- Higher-quality code search (substring-friendly indexing + structured ranking signals).
- More semantic diff previews for agent verification of refactors.

## Consequences

Reinforces the “portable core + strong previews” philosophy: make engine logic testable and make
agent-facing outputs easier to trust.

