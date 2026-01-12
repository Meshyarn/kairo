# ADR-059: EvidencePack/Summaries Lifecycle (prune/compact)

**Status:** Implemented  
**Date:** 2026-01-12  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`, `docs/plans/loadmap.md`

## Summary

EvidencePack 및 chunk summary 캐시의 장기 누적을 방지하기 위해 prune/compact 경로를 표준화하고, plan/apply 모드 및 백그라운드 prune 옵션을 제공한다.

## Decision (v1 Contract)

- `manage prune`에서 pack/summary/flow artifacts를 일괄 정리한다.
- prune는 expired/stale/cap 기준을 결합하고, compact는 안전한 rewrite로 수행한다.
- 결과는 report와 warnings로 반환하고, 메트릭으로 누적한다.

## Implementation Notes

- Storage maintenance: `src/indexing/StorageMaintenanceService.ts`
- IndexStore 확장(iterate/delete/compact): `src/storage/index/IndexTypes.ts`, `src/storage/index/IndexStore.ts`, `src/indexing/IndexDatabase.ts`
- manage prune 통합: `src/handlers/ManageHandlers.ts`
- background prune: `src/server/SmartContextServer.ts`
- flow artifacts persisted prune: `src/orchestration/flow-artifact-manager.ts`

## Config

- `KAIRO_STORAGE_PRUNE_INTERVAL_MS`: background prune 주기(ms)
- `KAIRO_STORAGE_PRUNE_ON_START`: 시작 시 1회 prune 실행
- `KAIRO_STORAGE_PRUNE_FLOW_ARTIFACTS`: flow artifacts prune 포함
- `KAIRO_STORAGE_PRUNE_COMPACT`: prune 후 compact(rewrite) 실행
- `KAIRO_EVIDENCE_PACK_STALE_CHECK_MAX_ITEMS`: pack stale 샘플링 상한
- `KAIRO_EVIDENCE_PACK_MAX_COUNT` / `KAIRO_EVIDENCE_PACK_MAX_BYTES`
- `KAIRO_CHUNK_SUMMARY_MAX_CHUNKS` / `KAIRO_CHUNK_SUMMARY_MAX_BYTES`

## Implementation Status (현 코드 기준)

- [x] Phase A: iterate/delete API 및 `manage prune` plan/apply 지원
- [x] Phase A: expired/stale/cap prune + report/metrics 제공
- [x] Phase B: compact(rewrite) + corrupt payload best-effort 정리
- [x] Phase C: background prune 옵션 및 기본 관측(카운터/게이지) 추가

## Testing

- Storage prune 단위 테스트: `src/tests/storage/StorageMaintenanceService.test.ts`
