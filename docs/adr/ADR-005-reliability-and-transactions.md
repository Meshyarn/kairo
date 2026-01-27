# ADR-005: Reliability and Transactional Editing (Historical)

**Status:** Proposed

## Context

Single-file edits were “mostly working”, but multi-file refactors and non-git environments
needed stronger safety nets: backups, undo/redo, and atomic batch edits.

## Decision

Define a phased roadmap for reliability:

- **Phase 1 (Safety net):** automatic backups for non-`dryRun` edits; undo/redo history with a
  structured change record (not only human-readable diffs); implement Levenshtein fuzzy mode.
- **Phase 2 (Transactional refactors):** a batch edit tool backed by an `EditTransaction` that
  stages changes in memory and commits atomically; rollback on any failure.
- **Phase 3 (Agent intelligence, conceptual):** AST-based symbol tools and higher-level
  “search + read + edit” workflow helpers.

## Notes (How It Evolved)

Later ADRs focus on robust contracts (plan→apply handshakes, draft snapshots) and on making the
edit pipeline deterministic and recoverable without relying on ad-hoc shell fixes.

