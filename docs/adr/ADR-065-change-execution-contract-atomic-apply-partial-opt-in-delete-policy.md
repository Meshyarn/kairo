# ADR-065: Change Execution Contract (atomic apply, partial opt-in, delete policy)

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-064-fileversion-handshake-read-apply.md`

## Summary

`edit_apply`의 기본 동작을 “요청 단위 원자성(atomic)”으로 고정하고, partial apply는 명시 opt-in으로만 허용한다. delete는 기본 차단하고 confirmation hash를 요구하도록 강화한다.

## Decision

- `edit_apply` 기본 `applyMode=atomic`, `deleteMode=forbid`
- `applyMode=partial`은 명시적으로만 허용
- delete는 `deleteMode=confirm` + confirmationHash(sha256)로만 허용
- dry-run 결과는 파일/오퍼레이션 단위로 표준화된 결과를 반환

## Implementation Notes

- ToolSpec 확장: `src/server/tools/ToolSpecRegistry.ts`
- 실행 계약/결과 스키마: `src/handlers/EditHandlers.ts`
- 타입 정리: `src/types/engine.ts`
- delete/create undo/redo 지원: `src/engine/EditCoordinator.ts`, `src/handlers/EditHandlers.ts`

## Testing

- delete/atomic/partial 흐름 테스트: `src/tests/handlers/EditHandlers.branches.test.ts`
- confirmation hash perf 확인: `src/tests/performance/edit_benchmark.test.ts`
