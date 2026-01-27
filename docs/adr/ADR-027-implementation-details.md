# ADR-027: Implementation Details (Historical)

**Status:** Supporting design notes for ADR-027

## Context

ADR-027 proposes fixing “stale index” behavior after ignore/config changes. This document is the
code-oriented companion: concrete file changes, method signatures, and integration points.

## Decision

Specify Stage 1 implementation steps, including:

- Watching `.gitignore` + `tsconfig.json/jsconfig.json` in `IncrementalIndexer`.
- Purging/re-enqueuing indexed files when ignore rules change.
- Resetting module resolver caches and re-analyzing unresolved dependencies after config changes.
- Adding a `manage_project reindex` command (clear DB + full rescan).

## Notes

This file is intentionally “implementation-first” and complements the higher-level ADR-027 plan.

