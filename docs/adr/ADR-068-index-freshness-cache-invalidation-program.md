# ADR-068: Index Freshness & Cache Invalidation Program

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `src/server/CacheInvalidationHub.ts`

## Summary

Reduce stale results by immediately wiring file change/delete/reindex events into cache invalidation. Surface stale-risk metrics in metrics/doctor, and block apply when index staleness is high (bypass only via override).

## Decision

- Centralize invalidation calls in `CacheInvalidationHub`.
- Immediately clear search/cluster/orchestration caches on file/directory events.
- Include stale-risk metrics in metrics and doctor.
- Block apply by default when stale risk is high (override required).

## Implementation Notes

- hub + wiring: `src/server/CacheInvalidationHub.ts`, `src/server/SmartContextServer.ts`, `src/indexing/IncrementalIndexer.ts`
- orchestration cache clear + epoch key: `src/orchestration/CachingStrategy.ts`
- invalidate counters + index metrics: `src/utils/MetricsCatalog.ts`, `src/handlers/ManageHandlers.ts`
- stale guard: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`
- override bypass key: `override.allow.staleGuard.bypass` (must be allowlisted by policy)

## Testing

- Verify cache hits do not remain stale immediately after file changes.
- In `project_manage metrics`, verify `index.*` metrics and `cache.invalidate.*` counters.
