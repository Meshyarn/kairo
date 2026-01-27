# ADR-008: Pragmatic Reliability Enhancements (Historical)

**Status:** Proposed (implementation-ready blueprint)

## Context

Reliability work found subtle but important failure modes in early safety features:

- Backups could capture the *wrong* content if the file changed between read and backup (TOCTOU).
- Levenshtein fuzzy mode needed correct “score all candidates → choose best unique match” logic.
- Ambiguity needed actionable diagnostics for agents (how to disambiguate and retry).

## Decision

Harden the edit pipeline with:

- **Race-condition-free backups:** backup the exact `originalContent` read at the start of the edit.
- **Correct Levenshtein selection:** score candidates, enforce thresholds, and fail on ties.
- **Actionable structured errors:** include conflicting line numbers and suggestions for narrowing
  the match (e.g., use a line range/anchors).

## Notes (How It Evolved)

The “resolve once, then apply safely” theme continues into later handshake-style contracts and
draft snapshotting to avoid TOCTOU across multi-step flows.

