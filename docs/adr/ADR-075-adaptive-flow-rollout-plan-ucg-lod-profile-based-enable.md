# ADR-075 (요약): Adaptive Flow Rollout Plan (UCG/LOD profile gate)

**Status:** Implemented (Phase A/B/C; ops guide ready)

## 의도

- canary/beta preset을 유지하면서 요청 단위의 profile/scale gate로 UCG/LOD 사용 범위를 제한한다.
- userId 기반 cohort 동작 여부를 `manage status`에서 바로 확인할 수 있게 한다.
- DecisionTrace에 gate 결정을 기록해 운영/디버깅 가시성을 강화한다.

## 진행 상황

- Adaptive Flow gate 계산 로직 도입(`src/orchestration/adaptive-flow/AdaptiveFlowGate.ts`).
- Explore/Understand/Change에서 gate 계산 + trace 기록 + context 공유 적용.
- UCG LOD 승격 호출 시 gate 상한 적용(Explore PathExpansion, Understand dependency graph, Change impact graph).
- `project_manage status`/`doctor` 응답에 rollout preset/userId hash/flag mode + gate 요약 노출.
- gate 매핑 단위 테스트 + DecisionTrace allowlist 테스트 추가.

## 구현 상태

- [x] Phase A: rollout 가시화 + 운영 진단 필드
- [x] Phase B: profile/scale gate + trace 기록
- [x] Phase C: beta 확대/운영 튜닝 절차(운영 단계; status/doctor 진단 + 런북 가이드는 준비됨)

## Phase C 운영 튜닝(가이드)

- **Beta 확대**: `KAIRO_ROLLOUT_MODE=beta` + `KAIRO_ROLLOUT_BETA_PERCENT=10 → 25 → 50` 순으로 확대(회귀 시 즉시 `legacy`로 롤백).
- **진단 확인**: `manage({ command: "status" })` 또는 `manage({ command: "doctor" })`의 `rollout.cohort` / `rollout.adaptiveFlow.alertThresholds` / `rollout.adaptiveFlow.metrics`로 현재 설정을 확인한다.
- **경보 튜닝(기본값)**:
  - `KAIRO_TOPOLOGY_SUCCESS_MIN=0.95`
  - `KAIRO_UCG_MEMORY_MAX_MB=500`
  - `KAIRO_L3_PROMOTION_RATIO_MAX=0.5`
