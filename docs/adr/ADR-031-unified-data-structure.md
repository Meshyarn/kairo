# ADR-031: Unified Runtime and Testing Data Structure (Historical)

**Status:** Proposed (2025-12-18)

## Context

Runtime and test artifacts were scattered across `.mcp/`, `.kairo/`, OS temp dirs, and ad-hoc
backup folders, making cleanup and tooling behavior harder to reason about.

## Decision

Standardize on a single project-local root: `.kairo/` (override via `KAIRO_DIR`), with a clear
layout for:

- Persistent data (indexes, caches, history/logs)
- Local config
- Ephemeral temp (tests/benchmarks), with predictable auto-cleanup targets

Require all modules to resolve through a central `PathManager`.

## Consequences

Improves portability and makes “reset the tool state” as simple as removing one directory, while
requiring a one-time migration/reindex for legacy paths.

