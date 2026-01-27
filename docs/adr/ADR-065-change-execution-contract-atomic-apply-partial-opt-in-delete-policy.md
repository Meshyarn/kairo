# ADR-065: Change Execution Contract (atomic apply, partial opt-in, delete policy)

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-064-fileversion-handshake-read-apply.md`

Lock `edit_apply` default behavior to request-level atomicity, allow partial apply only via explicit opt-in, and harden deletes by default-blocking them unless a confirmation hash is provided.

## Decision

- `edit_apply` defaults to `applyMode=atomic`, `deleteMode=forbid`
- `applyMode=partial` is allowed only with explicit opt-in
- Deletes are allowed only with `deleteMode=confirm` + `confirmationHash` (sha256)
- Dry-run returns standardized results per file/operation

## Implementation Notes

- ToolSpec extension: `src/server/tools/ToolSpecRegistry.ts`
- Execution contract + result schema: `src/handlers/EditHandlers.ts`
- Type cleanup: `src/types/engine.ts`
- delete/create undo/redo support: `src/engine/EditCoordinator.ts`, `src/handlers/EditHandlers.ts`

## Testing

- Delete/atomic/partial flow tests: `src/tests/handlers/EditHandlers.branches.test.ts`
- Confirmation hash perf check: `src/tests/performance/edit_benchmark.test.ts`
