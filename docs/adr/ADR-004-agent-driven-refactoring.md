# ADR-004: Agent-Driven Refactoring Roadmap (Historical)

**Status:** Proposed

## Context

After the early engine work (search/analyze/edit), the next problems were agent trust and
operational safety: sandbox boundaries, reliable ignore rules, portability, and better failure
recovery when edits don’t match exactly.

## Decision

Adopt a phased reliability-first roadmap:

- **P1 Security/Stability:** enforce a root sandbox for file tools; apply `.gitignore`/`.mcpignore`
  filtering by default; improve Windows portability (prefer `rg`, normalize paths/shell behavior).
- **P2 Agent reliability:** standardize structured error responses and include actionable retry
  hints; unify types as a single source of truth.
- **P3 Core refinements:** localized anchoring (limit anchor search radius); expand fuzzy matching
  modes beyond whitespace-only.
- **P4 QA:** benchmarks + E2E scenarios; coverage targets; token-budget-aware responses.

## Consequences

This ADR sets direction for the later “pillar + guardrails” architecture: safe-by-default
boundaries, explicit diagnostics, and predictable recovery paths.

