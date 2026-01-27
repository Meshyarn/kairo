# ADR-012: Project Intelligence (Enhanced Static Analysis) (Historical)

**Status:** Proposed

## Context

To support “find references”, dependency graphs, and impact analysis without full LSP/typecheck,
`kairo` needed a best-effort static analysis layer that can handle real-world imports/re-exports
and module resolution edge cases.

## Decision

Build a fast, robust static analysis engine on top of AST extraction:

- Extend extracted symbols to include **import/export semantics** (aliases, type-only, re-exports).
- Implement a lightweight **module resolver** (Node/TS-like heuristics, cached `stat` and results).
- Maintain a **dependency graph** with cycle detection for traversals.
- Expand Tree-sitter queries to cover common language constructs.

## Consequences

Provides actionable project “map” features without requiring language servers, but relies on
heuristics (explicitly “best effort”, not full semantic correctness).

