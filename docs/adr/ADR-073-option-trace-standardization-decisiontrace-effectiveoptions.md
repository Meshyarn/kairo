# ADR-073: Option Trace Standardization

**Status:** Implemented (Phase A/B/C)

## Intent

- Standardize previously inconsistent `effectiveOptions`/`decisionTrace` across pillars into a single v1 schema.
- Make trace outputs consistently explain “why something was skipped/downshifted/blocked” and “what to change to fix it”.

## Progress

- Introduced v1 types (`src/types/option-trace.ts`) and TraceBuilder, including event/skip caps and size limits.
- Added `trace` to the `manage` input schema and returned v1 trace/effectiveOptions in `manage` results.
- Applied v1 schema across `explore`/`understand`/`change`/`write`/`manage`.
- Recorded key decisions (overrides/guardrails/parity/staleness/repo-scope) as trace events/skips.
- Added contract/regression tests for trace plus TraceBuilder unit tests.

## Implementation Status

- [x] Phase A: v1 schema + `manage` trace input
- [x] Phase B: apply across the Five Pillars
- [x] Phase C: trace-based contract/scenario tests
