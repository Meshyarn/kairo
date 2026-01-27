# ADR-015: Agent Experience and Resilience Enhancements (Historical)

**Status:** Accepted / Implemented (2025-12-09)

## Context

Agent feedback highlighted recurring friction:

- WASM/AST loading quirks in CI/tests.
- Multi-line edits failing due to newline/indentation/whitespace differences.
- Smart file profiles missing “format” metadata (newline style, indentation, etc.).
- Errors didn’t always include clear next steps; no canonical agent playbook.
- Module resolution and “index reliability” were opaque to the agent.

## Decision

Ship coordinated, additive improvements:

- **AST backend abstraction + engine profiles** (prod/ci/test) to decouple parsing from env quirks.
- **Robust multi-line matching** via normalization and better diagnostics.
- **Enriched smart file profiles** with formatting + impact hints.
- **Agent workflow guidance** (playbook + actionable error hints).
- **Module resolution + index diagnostics** (aliases, status reporting).

## Consequences

Turns “works in the happy path” tooling into “predictably recoverable” workflows for agents across
different environments and repositories.

