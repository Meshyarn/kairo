# ADR-075: Adaptive Flow Rollout Plan (UCG/LOD profile gate)

**Status:** Implemented (Phase A/B/C; ops guide ready)

## Intent

- Keep canary/beta presets while limiting UCG/LOD usage via per-request profile/scale gates.
- Make userId-based cohort behavior visible in `manage status`.
- Record gate decisions into DecisionTrace to improve operational/debug visibility.

## Progress

- Adaptive Flow gate computation (`src/orchestration/adaptive-flow/AdaptiveFlowGate.ts`).
- Gate computation + trace recording + shared context wiring in Explore/Understand/Change.
- Apply gate caps when promoting UCG LOD (Explore PathExpansion, Understand dependency graph, Change impact graph).
- Surface rollout preset/userId hash/flag mode + gate summary in `project_manage status`/`doctor` responses.
- Add unit tests for gate mapping + DecisionTrace allowlist tests.

## Implementation Status

- [x] Phase A: rollout visibility + operational diagnostics fields
- [x] Phase B: profile/scale gates + trace recording
- [x] Phase C: beta expansion + operational tuning procedure (ops phase; status/doctor diagnostics + runbook guide ready)

## Phase C operational tuning (guide)

- **Beta expansion**: `KAIRO_ROLLOUT_MODE=beta` + increase `KAIRO_ROLLOUT_BETA_PERCENT=10 → 25 → 50` (roll back to `legacy` immediately on regressions).
- **Diagnostics**: use `manage({ command: "status" })` or `manage({ command: "doctor" })` and inspect `rollout.cohort` / `rollout.adaptiveFlow.alertThresholds` / `rollout.adaptiveFlow.metrics`.
- **Alert tuning (defaults)**:
  - `KAIRO_TOPOLOGY_SUCCESS_MIN=0.95`
  - `KAIRO_UCG_MEMORY_MAX_MB=500`
  - `KAIRO_L3_PROMOTION_RATIO_MAX=0.5`
