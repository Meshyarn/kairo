# ADR-067: Observability Baseline (bench accuracy + minimal metrics + optional OTel)

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `benchmarks/main.ts`, `src/utils/MetricsCollector.ts`

## Summary

벤치 정확도(경로/skip 처리)를 고정하고, 회귀 분해에 필요한 최소 메트릭 셋을 코드로 확정했다. 필요 시 JSONL/STDOUT/OTLP(옵션)로 메트릭을 export 할 수 있다.

## Decision

- 벤치는 repo root/PathManager 기준으로 경로를 계산하고 report에 근거를 표기한다.
- SKIP는 PASS 집계에서 제외하고 skip reason을 출력한다.
- 최소 메트릭 셋을 catalog로 고정하고, cache/guardrails/override 카운터를 보강한다.
- metrics exporter는 `stdout/jsonl/otel`을 선택적으로 활성화한다.

## Implementation Notes

- repo root resolver: `benchmarks/lib/repoRoot.ts`
- bench 경로 정정 + report 보강: `benchmarks/main.ts`
- SKIP 표준화: `benchmarks/phase2-performance.ts`
- 최소 메트릭 catalog + coverage: `src/utils/MetricsCatalog.ts`, `src/handlers/ManageHandlers.ts`
- cache/guardrails/override 카운터: `src/engine/ClusterSearch/ClusterCache.ts`, `src/documents/search/DocumentSearchEngine.ts`, `src/documents/search/EvidencePackBuilder.ts`, `src/orchestration/guardrails/IntegrityGuardrails.ts`, `src/utils/GuardrailsOverride.ts`
- exporter + lifecycle: `src/utils/metrics/*`, `src/server/SmartContextServer.ts`

## Config (env)

- `KAIRO_METRICS_MODE=off|basic|detailed` (default: `basic`)
- `KAIRO_METRICS_EXPORTER=off|stdout|jsonl|otel` (default: `off`)
- `KAIRO_METRICS_EXPORT_INTERVAL_MS=0|<ms>` (default: `0`, interval off)
- (OTel) `KAIRO_OTEL_ENDPOINT=http://.../v1/metrics`, `KAIRO_OTEL_SERVICE_NAME=kairo`

## Testing

- 벤치 경로 검증 및 skip 집계는 bench 실행 결과로 확인한다.
- `project_manage metrics`에서 catalogCoverage가 최소 셋을 만족하는지 확인한다.
