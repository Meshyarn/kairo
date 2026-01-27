# ADR-003: Advanced Algorithms Implementation (Historical)

**Status:** Proposed

## Context

To move beyond “shell wrapper” behavior, early `kairo` needed higher-quality primitives for:

- Search result relevance (not just “first file in traversal order”)
- Dry-run diff output that agents can reason about
- More forgiving matching when LLM output differs slightly from on-disk text

## Decision

Implement a small set of core algorithms in pure TypeScript (portable, no native bindings):

- **Myers diff** for `dryRun` outputs (git-style `+/-` diff visualization).
- **Okapi BM25 ranking** for search results.
- **Fuzzy matching** strategies that handle whitespace and small edit-distance differences
  (with performance safeguards).

## Notes (How It Evolved)

Later ADRs refine fuzzy match safety/performance (bounded search, ambiguity diagnostics), but the
“diff + rank + fuzzy” trio remains a baseline for reliable agent workflows.

