# ADR-026: Symbol Resolution Reliability & Workflow Guidance (Historical)

**Status:** Proposed (2025-12-14)

## Context

Production usage showed two major sources of agent failure:

- **Brittle symbol resolution** (substring matching, “first match wins”, stale indexes).
- **Tool selection confusion** (e.g., mixing filename search vs content search, no recovery hints).

## Decision

Improve reliability and UX by:

- Adding a **symbol resolution fallback chain** (better matching + ranking/scoring + suggestions).
- Supporting **incremental index updates** after edits to reduce stale results.
- Improving **workflow guidance** in errors (what to try next, example calls).
- Adding explicit **filename search** support to search tools (e.g., `type="filename"`).

## Consequences

Reduces wasted turns and makes “analyze relationship” style tools more dependable in real repos.

