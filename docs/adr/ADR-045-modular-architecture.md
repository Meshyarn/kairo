# ADR-045: Modular Architecture Optimization & Code Consolidation

**Status:** Implemented (curated)  
**Intent:** Keep the system maintainable by splitting oversized modules into testable, composable units.

## Summary

As features accumulated (docs ingestion, vector search, v2 editor, guardrails, multi-repo), several files became too large and responsibilities blurred.

This ADR reorganizes the system into clearer modules:

- Public MCP server stays thin (tool registration + wiring)
- Handlers group protocol-facing logic
- Pillars remain orchestration units, but are decomposed into submodules
- Shared utilities are consolidated to reduce duplication

## Decision

1) Decompose protocol surface into handlers (e.g. search/code/edit/document/manage).
2) Split large pillars into smaller files where the responsibilities are distinct:
   - change execution vs impact analysis vs integrity validation, etc.
3) Keep tool names stable while reorganizing internals.

## Implementation notes (current repo)

Handlers:

- `src/handlers/*`

Change pillar decomposition:

- `src/orchestration/pillars/change/*`

Explore pillar decomposition:

- `src/orchestration/pillars/explore/*`

This modularity is what makes it feasible to keep `docs` accurate and tests focused as the system evolves.

