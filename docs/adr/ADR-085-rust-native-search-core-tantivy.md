# ADR-085: Rust Native Search Core (Tantivy Integration) (Summary)

**Status:** Implemented  
**Date:** 2026-01-21  
**Related:** `docs/adr/ADR-053-H-universal-hybrid-architecture.md`, `docs/adr/ADR-069-search-index-scalability-without-sqlite.md`, `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md`

## Summary

This is a curated summary of the upstream ADR-085 design document.

ADR-085 replaces Kairo’s legacy JS search stack (trigram JSON index + JS reranking) with a Tantivy-backed native search core shipped via `@kairo/core-rs` (N-API). The goal is to reduce p95 search latency and remove search-index heap pressure, keeping the MCP timebox model (ADR-084) reliable on large repositories.

## Decision

- Search/index “single truth” is Tantivy via `@kairo/core-rs`; no long-lived dual-read/dual-write path.
- Index lives under `${KAIRO_DIR}/data/index[/repos/<repoId>]/v2-tantivy`; legacy trigram artifacts are removed.
- Index uses a single-writer lock; lock contention opens the index read-only and surfaces degraded reason `index_write_locked` (via `manage status`).
- Query intent is handled in the native layer (path/symbol/text heuristics) with BM25 scoring + field boosts; ngram analysis replaces trigram matching.
- Vector/ANN search remains a separate module; native search provides fast lexical candidates for higher-level flows.

## Implementation Notes

- Native loader + capability gating: `src/orchestration/capabilities/NativeModuleLoader.ts`
- Native search wrapper + index dir management: `src/engine/search/native/NativeSearchCore.ts`
- File search uses native core: `src/engine/Search.ts`
- Operational status/reindex wiring: `src/handlers/ManageHandlers.ts`
- Error → degradedReasons mapping: `src/orchestration/DegradedReasonMapper.ts`

## Ops / Failure Modes

- Missing native module: `CAP_NATIVE_SEARCH_UNAVAILABLE` (build with `npm run build:core-rs`).
- Index locked by another process: `INDEX_WRITE_LOCKED` / degraded `index_write_locked` (read-only mode; writes/reindex require the lock).
- Index corrupted / schema mismatch: rebuild via `manage({ command: "reindex" })` and inspect diagnostics via `manage({ command: "doctor" })`.

## Performance Gate

- Benchmark script: `npm run benchmark:adr-085-search-slo` (writes JSON reports under `benchmarks/reports/`).
- Default thresholds: native search p95 ≤ 50ms; file-search p95 ≤ 120ms; heap delta ≤ 64MB; index size ≤ 256MB.
- Example (synthetic 2k files): native search p95 ~0.24ms; file-search p95 ~1.43ms; heap delta ~-2MB; index size ~0.64MB.

## Testing

- Jest: native core capability/degraded mappings + manage status paths.
- Smoke: `npm run smoke:mcp-inprocess` and `npm run smoke:mcp-mock-client`.
