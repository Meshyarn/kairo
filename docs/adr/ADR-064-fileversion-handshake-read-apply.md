# ADR-064: FileVersion Handshake (read↔apply)

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`

## Summary

read 결과의 `versionInfo`를 apply에 전달해 stale 편집을 사전 차단하고, mismatch 시 “현재 상태 + 재시도 가이드”를 반환해 루프를 단축한다.

## Decision

- `file_read`/`file_fragment_read`는 `versionInfo`를 반환한다.
- `edit_apply`/`edit_transaction`는 `fileVersions`를 검증하고 mismatch 시 block한다.
- `change/write` apply는 `fileVersions`를 전달하고, mismatch를 blocked 응답으로 승격한다.
- DraftPack에 fileVersions 스냅샷을 저장해 plan→apply 핸드셰이크를 유지한다.

## Implementation Notes

- read 도구: `src/handlers/code/CodeReadOps.ts`
- edit_apply/transaction 검증: `src/handlers/EditHandlers.ts`
- schema 확장: `src/server/tools/ToolSpecRegistry.ts`
- read pillar versionInfo: `src/orchestration/pillars/ReadPillar.ts`
- change/write apply 전달 + mismatch block: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/change/BatchExecution.ts`, `src/orchestration/pillars/WritePillar.ts`
- DraftPack 스냅샷: `src/types/flow-artifacts.ts`

## Testing

- edit_apply mismatch/성공: `src/tests/handlers/EditHandlers.fileVersions.test.ts`
- file_read/file_fragment_read versionInfo: `src/tests/read_file.test.ts`, `src/tests/read_file_regions.test.ts`
