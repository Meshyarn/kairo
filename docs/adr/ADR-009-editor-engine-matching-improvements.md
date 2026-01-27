# ADR-009: EditorEngine String Matching Improvements (Historical)

**Status:** Proposed (2024-12-06)

## Context

This ADR focuses on improving edit target matching quality:

- Word-boundary `\\b` regex fails for targets starting/ending with symbols.
- Levenshtein mode was ineffective if no exact match existed.
- Line-number reporting was too slow on large files.

## Decision

Improve matching with:

- **Boundary assertions** (lookbehind/lookahead) that prevent partial identifier matches while
  allowing symbol boundaries.
- **Sliding-window Levenshtein search** as a real fallback when exact match fails, optionally
  restricted by `lineRange` and optimized to check likely boundary positions.
- **Precomputed line index** for O(log N) line lookup via binary search.

## Notes

The upstream text contains a heading typo (`ADR-001`), but it’s part of the ADR-009 edit pipeline
workstream.

