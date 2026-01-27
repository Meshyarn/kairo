# ADR-009: EditorEngine String Matching & Performance Improvements (Historical)

**Status:** Proposed (2024-12-07)

## Context

Early `EditorEngine` matching had correctness and performance issues:

- `\\b` word-boundary regex breaks on symbol-heavy code (`{`, `@`, `.`, `)`).
- Levenshtein “fuzzy” mode never ran unless an exact regex match existed (paradox).
- Line-number computation was O(N×M) (re-splitting content for each match).

## Decision

Refactor matching in phases:

- **Line indexing:** precompute line-start offsets and use binary search for fast line lookups.
- **Context-aware boundaries:** replace naive `\\b` with boundary assertions that only guard
  alphanumeric identifier edges (allow symbols at boundaries).
- **True fuzzy fallback:** implement a sliding-window fuzzy search with strict performance guards
  (max target length, candidate limit/op budget, threshold ratio) and ambiguity handling.

## Consequences

- More reliable edits on real code snippets (symbols at edges).
- Predictable performance on large files (bounded fuzzy search + fast line lookups).

