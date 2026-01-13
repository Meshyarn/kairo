# ADR-063: Capability Diagnostics & Provider Policy Integration

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`, `docs/plans/loadmap.md`

## Summary

운영자가 `manage`/`doctor`에서 capability/provider 상태와 비가용 사유(예: rust core 로딩 실패, tokenizer 미발견)를 바로 확인할 수 있도록 “진단 스냅샷”을 표준화한다.

## Decision

- `manage status`에 capability diagnostics 스냅샷을 포함한다.
- `manage doctor`는 host/parity/capabilities 범위에서 capability 진단과 힌트를 제공한다.
- provider는 optional `diagnose()`를 통해 “왜 unavailable인지”를 설명할 수 있다.
- tokenizer 탐색 로직을 공용 유틸로 승격해 Rust chunking/doctor가 동일한 판단을 사용한다.

## Implementation Notes

- diagnostics 스냅샷: `src/orchestration/capabilities/EngineManager.ts`
- metrics tier tagging: `src/orchestration/capabilities/EngineManager.ts` (`capability.select.*`, `capability.fallback.*`)
- tokenizer 공용 유틸: `src/orchestration/capabilities/TokenizerDiagnostics.ts`
- rust chunking 진단 연동: `src/orchestration/capabilities/providers/RustChunkingProvider.ts`
- manage 스키마/출력 확장: `src/server/tools/ToolSpecRegistry.ts`, `src/handlers/ManageHandlers.ts`
- doctor scope 확장(캡ability scope 포함): `src/config/ConfigBootstrapper.ts`

## Testing

- capability registry 진단: `src/tests/orchestration/DefaultEngineRegistry.test.ts`
- tokenizer 진단: `src/tests/orchestration/TokenizerDiagnostics.test.ts`
- manage status 출력: `src/tests/handlers/ManageHandlers.more.test.ts`
