# ADR-064: FileVersion Handshake (read↔apply)

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`

Pass `versionInfo` from read results into apply calls to proactively block stale edits, and on mismatch return “current state + retry guidance” to shorten the loop.

## Decision

- `file_read`/`file_fragment_read` return `versionInfo`.
- `edit_apply`/`edit_transaction` validate `fileVersions` and block on mismatch.
- `change`/`write` apply passes `fileVersions` and escalates mismatches to a blocked response.
- Store a `fileVersions` snapshot in DraftPack to preserve the plan→apply handshake.

## Implementation Notes

- read tools: `src/handlers/code/CodeReadOps.ts`
- edit_apply/transaction validation: `src/handlers/EditHandlers.ts`
- schema extension: `src/server/tools/ToolSpecRegistry.ts`
- read pillar versionInfo: `src/orchestration/pillars/ReadPillar.ts`
- change/write apply pass-through + mismatch blocking: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/change/BatchExecution.ts`, `src/orchestration/pillars/WritePillar.ts`
- DraftPack snapshot: `src/types/flow-artifacts.ts`

## Testing

- edit_apply mismatch/success: `src/tests/handlers/EditHandlers.fileVersions.test.ts`
- file_read/file_fragment_read versionInfo: `src/tests/read_file.test.ts`, `src/tests/read_file_regions.test.ts`
