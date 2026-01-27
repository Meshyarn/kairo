# ADR-072: Pillar Decomposition & Module Boundary Hardening

**Status:** Implemented (Phase A/B/C)

## Intent

- Split each pillar into input normalization / planning / collection / decision / formatting / post-processing, and lock down testable boundaries.
- Preserve external schemas/behavior while refactoring internal structure.

## Progress

- Read: create a baseline pipeline boundary by splitting Input/Formatter modules.
- Explore/Understand/Change/Write: introduce InputNormalizer (split initial parsing/option normalization).
- Move shared WorkflowMeta utilities into `pillars/shared` and reuse them in Change/Write.
- Extract override decision logic into a shared Decision module and add unit tests.
- Extract Explore budget/compression decisions into a Decision module and add unit tests.
- Extract Understand decisions (graph/compression/fallback) into a Decision module and add unit tests.
- Extract Change/Write guardrails decisions (Integrity guardrails) into a Decision module and add unit tests.
- Add Decision-module timing metrics (override/guardrail/budget/compression).
- Add timing metrics for guardrail evaluation (`evaluateIntegrityGuardrails`).

## Implementation Status

- [x] Phase A: split common utilities/builders/formatters
  - [x] Read Input/Formatter split
  - [x] Explore/Understand/Change/Write InputNormalizer
  - [x] Composer reduction + shared utility moves
- [x] Phase B: modularize decision logic + tests
  - [x] Override decision module split + tests
  - [x] Explore budget/compression decision module split + tests
  - [x] Understand decisions (graph/compression/fallback) module split + tests
  - [x] Change/Write guardrails decision module split + tests
- [x] Phase C: lock hot-path boundaries + instrumentation
  - [x] Decision module timing metrics
  - [x] Guardrails evaluation timing metrics
  - [x] Module-level bottleneck measurement/optimization loop (added benchmark script)

## Observability checks

- Run with `KAIRO_METRICS_MODE=detailed`, then call `manage` → `metrics` to inspect `decision.*` and `guardrails.integrity_total_ms` histograms.
- Local bench: `npm run benchmark:adr-072-metrics` (snapshots are stored in `benchmarks/reports/`)
