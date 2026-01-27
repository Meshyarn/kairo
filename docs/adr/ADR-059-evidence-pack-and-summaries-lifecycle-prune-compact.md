# ADR-059: EvidencePack/Summaries Lifecycle (prune/compact)

**Status:** Implemented  
**Date:** 2026-01-12  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`

Standardize prune/compact flows to prevent unbounded accumulation of EvidencePacks and chunk-summary caches, with plan/apply modes and background prune options.

## Decision (v1 Contract)

- `manage prune` performs bulk cleanup for packs/summaries/flow artifacts.
- Prune combines expired/stale/cap criteria; compact performs a safe rewrite.
- Return results as reports and warnings, and accumulate metrics.

## Implementation Notes

- Storage maintenance: `src/indexing/StorageMaintenanceService.ts`
- IndexStore extensions (iterate/delete/compact): `src/storage/index/IndexTypes.ts`, `src/storage/index/IndexStore.ts`, `src/indexing/IndexDatabase.ts`
- `manage prune` integration: `src/handlers/ManageHandlers.ts`
- background prune: `src/server/SmartContextServer.ts`
- flow artifacts persisted prune: `src/orchestration/flow-artifact-manager.ts`

## Config

- `KAIRO_STORAGE_PRUNE_INTERVAL_MS`: background prune interval (ms)
- `KAIRO_STORAGE_PRUNE_ON_START`: run prune once on startup
- `KAIRO_STORAGE_PRUNE_FLOW_ARTIFACTS`: include flow-artifact pruning
- `KAIRO_STORAGE_PRUNE_COMPACT`: run compact (rewrite) after prune
- `KAIRO_EVIDENCE_PACK_STALE_CHECK_MAX_ITEMS`: max stale-check samples per pack
- `KAIRO_EVIDENCE_PACK_MAX_COUNT` / `KAIRO_EVIDENCE_PACK_MAX_BYTES`
- `KAIRO_CHUNK_SUMMARY_MAX_CHUNKS` / `KAIRO_CHUNK_SUMMARY_MAX_BYTES`

## Implementation Status (as of current code)

- [x] Phase A: iterate/delete APIs + `manage prune` plan/apply support
- [x] Phase A: expired/stale/cap pruning + reports/metrics
- [x] Phase B: compact (rewrite) + best-effort cleanup of corrupt payloads
- [x] Phase C: background prune options + baseline telemetry (counters/gauges)

## Testing

- Storage prune unit tests: `src/tests/storage/StorageMaintenanceService.test.ts`
