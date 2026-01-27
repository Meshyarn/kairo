# ADR-071: IFileSystem Boundary Expansion & Testability Hardening

**Status:** Implemented (Phase A/B/C)

## Intent

- Expand boundaries so core logic (orchestration/handlers) performs file I/O via `IFileSystem` instead of calling `fs` directly.
- Reduce disk dependency/flakiness/platform drift via memory-first tests.
- Prevent regressions by validating “no direct `fs` imports” with scripts.

## What shipped (Phase A–C)

- Remove direct `fs` imports from `src/orchestration/**` and `src/handlers/**` (platform adapters are exceptions).
- Standardize `HandlerContext.fileSystem` as an `IFileSystem`.
- Orchestration components receive an injected `IFileSystem` when needed, or use `NodeFileSystem` as an internal default.
- Add drift guardrail scripts to block `fs` imports within the Phase A scope.
- Expand the boundary for `src/indexing/**` (adapterization + improved persistence tests).
- Expand the boundary for `src/ast/**` (including resolver/graph) + strengthen regression tests.

## Verification / Testing

- Verify Phase A boundary violations (strict mode): `npm run validate:fs`
- Verify Phase B boundary violations (strict mode): `npm run validate:fs:b`
- Verify Phase C boundary violations (strict mode): `npm run validate:fs:c`
- Add `MemoryFileSystem`-based save/load tests for the `UnifiedContextGraph` persistence path.

## Implementation Status

- [x] Phase A: lock orchestration/handlers boundary + MemoryFS tests + validation scripts
- [x] Phase B: expand indexing boundary (adapterization + tests)
- [x] Phase C: expand AST boundary (resolver/graph + tests)
