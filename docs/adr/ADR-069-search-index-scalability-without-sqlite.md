# ADR-069: Search/Index Scalability without SQLite (baseline async, secondary index)

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `docs/plans/loadmap.md`, `src/ast/SymbolIndex.ts`, `src/indexing/IncrementalIndexer.ts`, `src/storage/index/IndexStore.ts`, `src/handlers/ManageHandlers.ts`

## Summary

Baseline sync가 요청을 블로킹하지 않도록 비동기/점진화하고, 심볼 검색은 secondary index(trigram 기반)로 선형 병목을 줄였다. 또한 storage/index 예산을 metrics/doctor에서 확인할 수 있도록 정리했다.

## Decision

- baseline sync는 background 진행이 기본이며, 필요 시에만 wait 한다.
- `searchSymbols()`는 trigram 후보 축소를 먼저 사용하고, 짧은 쿼리는 선형 fallback을 허용한다.
- secondary index는 별도 파일로 저장하며 손상/누락 시 rebuild가 가능하다.
- budget 사용량은 doctor/metrics에서 확인 가능해야 한다.

## Implementation Notes

- baseline async + caps: `src/ast/SymbolIndex.ts`, `src/indexing/IncrementalIndexer.ts`, `src/server/SmartContextServer.ts`
- secondary index: `src/storage/index/IndexStore.ts`
- budget metrics/doctor: `src/handlers/ManageHandlers.ts`, `src/utils/MetricsCatalog.ts`
- benchmark: `benchmarks/symbol-search-scalability.ts`

## Testing

- baseline non-blocking 동작과 search 결과의 best-effort 반환을 확인한다.
- secondary index rebuild 및 fallback 경로를 점검한다.
- `project_manage metrics` / `project_manage doctor`에서 budget 및 baseline 지표를 확인한다.
