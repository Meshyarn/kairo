# ADR-078 (요약): Cost Stabilization & Adaptive LOD (Lean-first)

## 의도

- Lean preset으로 기본 호출 비용을 예측 가능하게 고정한다.
- 비용 메트릭/게이트를 status/doctor에 노출해 회귀를 조기에 감지한다.
- Stable Success 기반 downshift는 후속 단계(Phase C)로 둔다.

## 진행 상황

- `profile=lean`을 지원하고 탐색/이해/변경/쓰기에서 저비용 기본값을 적용한다.
- `explore/understand`에 total latency 메트릭을 추가하고 `manage status/doctor`에 비용 요약(histograms)을 노출한다.
- scale tier(S/M/L) 계산을 `manage status/doctor`에 포함한다(환경변수로 기준 조정 가능).
- 비용 SLO 게이트 스크립트(`benchmark:adr-078-cost-slo`)로 lean preset 비용 회귀를 스냅샷/검증한다.
- Stable Success 기반 Adaptive LOD downshift를 적용하고 `adaptive_lod.downshift` trace로 근거를 노출한다.
  - v1은 undo/redo 및 `budget_exceeded`/`response_budget_exceeded` 같은 비용 신호를 “불안정”으로 취급해 downshift 한다.

## 구현 상태

- [x] Phase A: Lean preset + 최소 비용 메트릭/trace를 status/doctor에 연결
- [x] Phase B: 비용 SLO/회귀 게이트를 벤치/CI에 정착
- [x] Phase C: Stable Success 기반 LOD downshift v1 도입

## 설정 메모

- `KAIRO_SCALE_TIER_S_MAX_FILES`, `KAIRO_SCALE_TIER_M_MAX_FILES`로 scale tier 기준을 조정한다.
- 벤치/게이트 실행: `npm run benchmark:adr-078-cost-slo` (lean 기본 시나리오 비용 스냅샷 저장).
- Adaptive LOD: `KAIRO_ADAPTIVE_LOD_ENABLED`, `KAIRO_ADAPTIVE_LOD_WINDOW`, `KAIRO_ADAPTIVE_LOD_COOLDOWN_CALLS`.
