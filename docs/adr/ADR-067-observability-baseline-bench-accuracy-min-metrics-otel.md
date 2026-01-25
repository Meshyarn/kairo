# ADR-067: Observability Baseline (bench accuracy + minimal metrics + optional OTel)

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `benchmarks/main.ts`, `src/utils/MetricsCollector.ts`

## Summary

Lock down benchmark accuracy (paths/skip handling) and codify the minimal metric set needed for regression attribution. Metrics can be exported via JSONL/STDOUT/OTLP (optional) when needed.

## Decision

- Benchmarks compute paths relative to repo root/PathManager and record the basis in the report.
- SKIP is excluded from PASS counts, and skip reasons are printed.
- Fix the minimal metric set as a catalog and add counters for cache/guardrails/overrides.
- Enable metric exporters optionally via `stdout/jsonl/otel`.

## Implementation Notes

- repo root resolver: `benchmarks/lib/repoRoot.ts`
- bench path correctness + report improvements: `benchmarks/main.ts`
- SKIP standardization: `benchmarks/phase2-performance.ts`
- Minimal metric catalog + coverage: `src/utils/MetricsCatalog.ts`, `src/handlers/ManageHandlers.ts`
- cache/guardrails/override counters: `src/engine/ClusterSearch/ClusterCache.ts`, `src/documents/search/DocumentSearchEngine.ts`, `src/documents/search/EvidencePackBuilder.ts`, `src/orchestration/guardrails/IntegrityGuardrails.ts`, `src/utils/GuardrailsOverride.ts`
- exporter + lifecycle: `src/utils/metrics/*`, `src/server/SmartContextServer.ts`

## Config (env)

- `KAIRO_METRICS_MODE=off|basic|detailed` (default: `basic`)
- `KAIRO_METRICS_EXPORTER=off|stdout|jsonl|otel` (default: `off`)
- `KAIRO_METRICS_EXPORT_INTERVAL_MS=0|<ms>` (default: `0`, interval off)
- (OTel) `KAIRO_OTEL_ENDPOINT=http://.../v1/metrics`, `KAIRO_OTEL_SERVICE_NAME=kairo`

## Testing

- Verify bench path correctness and skip accounting via benchmark runs.
- Check `project_manage metrics` for `catalogCoverage` meeting the minimal set.
