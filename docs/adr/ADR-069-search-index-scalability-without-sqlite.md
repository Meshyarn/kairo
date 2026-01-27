# ADR-069: Search/Index Scalability without SQLite (baseline async, secondary index)

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `src/ast/SymbolIndex.ts`, `src/indexing/IncrementalIndexer.ts`, `src/storage/index/IndexStore.ts`, `src/handlers/ManageHandlers.ts`

Make baseline sync asynchronous/incremental so it does not block requests, and reduce linear bottlenecks in symbol search via a secondary (trigram-based) index. Also surface storage/index budget signals in metrics/doctor.

## Decision

- Baseline sync runs in the background by default and only waits when necessary.
- `searchSymbols()` uses trigram candidate reduction first, and allows a linear fallback for short queries.
- The secondary index is stored as a separate file and can be rebuilt if missing/corrupted.
- Budget usage must be visible via doctor/metrics.

## Implementation Notes

- baseline async + caps: `src/ast/SymbolIndex.ts`, `src/indexing/IncrementalIndexer.ts`, `src/server/SmartContextServer.ts`
- secondary index: `src/storage/index/IndexStore.ts`
- budget metrics/doctor: `src/handlers/ManageHandlers.ts`, `src/utils/MetricsCatalog.ts`
- benchmark: `benchmarks/adr/symbol-search-scalability.ts`

## Testing

- Verify baseline non-blocking behavior and best-effort search results.
- Verify secondary index rebuild and fallback paths.
- Verify budget and baseline metrics via `project_manage metrics` / `project_manage doctor`.
