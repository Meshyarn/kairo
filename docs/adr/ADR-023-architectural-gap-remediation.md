# ADR-023: Architectural Gap Remediation Strategy (Historical)

**Status:** Proposed (enhanced via codebase audit, 2025-12-12)

## Context

A deep audit identified multiple “design vs implementation” gaps and integration misses:

- Transaction/rollback behavior was best-effort and could fail silently (risking corruption).
- Matching/search and ranking signals existed but weren’t integrated (e.g., TrigramIndex, call graph).
- Duplicated language/extension maps increased maintenance risk.
- Some caches/queues lacked bounding/monitoring.

## Decision

Prioritize hardening the safety and indexing foundation by:

- Strengthening transactional edits (persistent logging, snapshot-based rollback, hash verification).
- Reusing existing infrastructure where possible (shared DB/WAL patterns, existing index store).
- Consolidating duplicated config (single source for extension/language mapping).
- Adding bounded caches + operational diagnostics (queue depth, cache size, etc.).

## Consequences

Turns “best effort” behaviors into explicit, observable contracts and reduces the risk of silent
repo corruption during multi-file operations.

