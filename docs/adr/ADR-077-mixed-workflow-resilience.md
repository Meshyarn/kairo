# ADR-077 (요약): Mixed-workflow Resilience (Interop/Drift/Reconcile + Checkpoints + Integrity UX)

## 의도

- 혼합 편집 환경을 정상 경로로 다루고 drift를 상태로 노출한다.
- 과차단을 줄이고 복구 루트를 표준화한다.
- apply 단위의 최소 체크포인트(트랜잭션 레저)로 변경 추적을 가능하게 한다.

## 진행 상황

- `manage status/doctor`에 workspace/repo 단위 drift 요약을 노출한다(mtime 신호 기반, best-effort).
- (선택) `.kairo/config/scopes.json`를 통해 serviceRoot 스코프를 수동 정의할 수 있다.
- drift가 감지되면 `manage reindex(paths=...)`(가능 시) → `manage reindex` 순의 repairActions를 함께 제공한다.
- `manage history`에서 최근 커밋된 트랜잭션 체크포인트 요약을 제공한다.
- 트랜잭션 커밋 시 diff 요약(lines added/deleted/changed)을 기록한다.
- repair ladder 태그와 degraded severity를 표준 응답에 포함한다.
- mixed-workflow 복구 플레이북을 가이드에 추가한다.

## 구현 상태

- [x] Phase A: drift 상태 모델 + status/doctor 노출 + checkpoint 요약
- [x] Phase B: reconcile ladder/확장된 severity 모델
- [x] Phase C: mixed workflow 플레이북/가이드 고정

## Deferred (추가 구현 필요)

- [x] drift 신호 확장(hash/index revision/untracked 등)
- [x] serviceRoot discovery(매니페스트 기반) + scope confidence 고도화
- [x] patchRef/patch blob store + `manage export` 연동
- [x] 외부 편집 시나리오 통합/E2E 회귀 테스트 추가
