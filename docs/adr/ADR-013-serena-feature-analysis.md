# ADR-013: Serena Feature Analysis & Enhancement Plan (Historical)

**Status:** Proposed (2024-12-08)

## Context

The project evaluated the `oraios/serena` MCP server to identify high-value features to port,
while keeping `kairo` “static analysis lite” (no LSP processes; Tree-sitter + lightweight caches).

## Decision

Adopt a selective strategy: copy useful workflows/patterns, not LSP dependencies.

Prioritized enhancements:

- **Find references (high):** “import-aware reference search” using the dependency graph to scope
  candidates, then Tree-sitter identifier queries to collect structured reference results.
- **Doc extraction (medium):** extract JSDoc/TSDoc into symbol metadata so agents can avoid reading
  implementation details.
- **Safe rename (medium):** preview-only rename that returns an explicit edit plan; apply requires
  a separate confirmation step.

## Consequences

Improves semantic navigation while preserving offline-first, dependency-light operation.

