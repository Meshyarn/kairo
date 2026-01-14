# ADR-068: Index Freshness & Cache Invalidation Program

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `docs/plans/loadmap.md`, `src/server/CacheInvalidationHub.ts`

## Summary

파일 변경/삭제/리인덱스 이벤트를 캐시 무효화로 즉시 연결해 stale 결과를 줄였다. stale risk 지표를 메트릭/doctor에 노출하고, 인덱스 stale이 높은 상태에서는 apply를 차단(override로만 우회)한다.

## Decision

- `CacheInvalidationHub`로 invalidate 호출을 중앙 집선한다.
- 파일/디렉토리 이벤트에 맞춰 search/cluster/orchestration 캐시를 즉시 정리한다.
- stale risk 지표를 메트릭과 doctor에 포함한다.
- stale risk가 high일 때 apply를 기본 차단한다(override 필요).

## Implementation Notes

- hub + wiring: `src/server/CacheInvalidationHub.ts`, `src/server/SmartContextServer.ts`, `src/indexing/IncrementalIndexer.ts`
- orchestration cache clear + epoch key: `src/orchestration/CachingStrategy.ts`
- invalidate counters + index metrics: `src/utils/MetricsCatalog.ts`, `src/handlers/ManageHandlers.ts`
- stale guard: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`
- override bypass key: `override.allow.staleGuard.bypass` (policy allowlist 필요)

## Testing

- 파일 변경 직후 cache hit가 stale로 남지 않는지 확인한다.
- `project_manage metrics`에서 `index.*` 지표와 `cache.invalidate.*` 카운터를 확인한다.
