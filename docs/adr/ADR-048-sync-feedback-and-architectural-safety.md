# ADR-048: Index Sync Feedback Loop & Architectural Safety Guardrails (Historical)

**Status:** Implemented (2026-01-09)

## Context

Two gaps reduced agent trust:

- Agents couldn’t tell if results came from a fresh index or stale data (batch indexing lag).
- Edit safety focused on syntax, not architectural risk (cycles, “core module” blast radius).

## Decision

Add two layers of guardrails:

- **Index feedback loop:** expose `indexSnapshot`/`indexingActivity` in `manage status` and surface
  snapshot metadata in `explore/understand` so agents can reason about freshness/coverage.
- **Architectural safety guardrails:** preflight checks for dependency cycles and “core impact”
  scoring (PageRank/incoming deps), then automatically warn/block based on policy.

## Consequences

Improves transparency (“is the index trustworthy?”) and prevents structurally risky changes from
slipping through even when syntax validation passes.

