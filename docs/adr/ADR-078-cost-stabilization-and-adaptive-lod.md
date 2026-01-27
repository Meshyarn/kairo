# ADR-078: Cost Stabilization & Adaptive LOD (Lean-first)

## Intent

- Make default call cost predictable by anchoring the default to the Lean preset.
- Surface cost metrics/gates in status/doctor to catch regressions early.
- Stage Stable Success-based downshift for a later phase (Phase C).

## Progress

- Support `profile=lean` and apply low-cost defaults across explore/understand/change/write.
- Add total latency metrics to `explore/understand` and expose cost summaries (histograms) in `manage status/doctor`.
- Include scale tier (S/M/L) calculation in `manage status/doctor` (thresholds configurable via env vars).
- Snapshot/verify Lean preset cost regressions via the SLO gate script (`benchmark:adr-078-cost-slo`).
- Apply Adaptive LOD downshift based on Stable Success and expose rationale via the `adaptive_lod.downshift` trace event.
  - v1 treats undo/redo and cost signals like `budget_exceeded`/`response_budget_exceeded` as “unstable” and downshifts accordingly.

## Implementation Status

- [x] Phase A: Lean preset + minimal cost metrics/trace integrated into status/doctor
- [x] Phase B: cost SLO/regression gates established in benchmarks/CI
- [x] Phase C: Stable Success-based LOD downshift v1 introduced

## Configuration Notes

- Adjust scale tier thresholds with `KAIRO_SCALE_TIER_S_MAX_FILES` and `KAIRO_SCALE_TIER_M_MAX_FILES`.
- Run the benchmark/gate: `npm run benchmark:adr-078-cost-slo` (stores a Lean baseline cost snapshot).
- Adaptive LOD: `KAIRO_ADAPTIVE_LOD_ENABLED`, `KAIRO_ADAPTIVE_LOD_WINDOW`, `KAIRO_ADAPTIVE_LOD_COOLDOWN_CALLS`.
