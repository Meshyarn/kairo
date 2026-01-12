# ADR-058: Tool Schema Contract & Compatibility Layer

**Status:** Implemented  
**Date:** 2026-01-12  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/plans/loadmap.md`

## Summary

Tool 입력 계약을 ToolSpec Registry로 단일화하고, compat/strict 모드에서 alias/unknown 필드 처리와 검증을 표준화한다.

## Decision (v1 Contract)

- ListTools 스키마는 ToolSpec Registry가 단일 출처다.
- 모든 호출은 `normalize → validate → execute` 파이프라인을 거친다.
- alias/unknown/coercion은 `contract.findings`로 표준 경고를 남긴다.
- strict 모드(`KAIRO_TOOL_SCHEMA_MODE=strict`)에서는 unknown 필드를 차단한다.

## Implementation Notes

- ToolSpec Registry: `src/server/tools/ToolSpecRegistry.ts`
- Normalize/validate: `src/server/tools/ToolArgs.ts`
- Server entrypoint 적용: `src/server/SmartContextServer.ts`

## Implementation Status (현 코드 기준)

- [x] Phase A: ToolSpec Registry + `limits.maxTokens` 스키마 반영 (explore/understand)
- [x] Phase B: compat alias (`file_read.raw → full`, `limits.max_tokens → limits.maxTokens`) + `contract.findings` 경고 표준화
- [x] Phase C: schema/alias/strict 모드 회귀 테스트 추가
- [x] 내부 도구 스키마 드리프트 보강: `file_search`/`file_scout`가 실제 지원하는 `keywords/basePath/excludeGlobs/wordBoundary/...`를 스키마에 반영(compat 드랍 방지)

## Testing

- 스키마 필드 보장/alias/strict 모드 테스트: `src/tests/tool_schema_contract.test.ts`
