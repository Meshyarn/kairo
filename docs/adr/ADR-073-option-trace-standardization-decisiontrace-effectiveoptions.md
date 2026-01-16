# ADR-073 (요약): Option Trace 표준화

**Status:** Implemented (Phase A/B/C)

## 의도

- pillar별로 들쭉날쭉했던 `effectiveOptions`/`decisionTrace`를 v1 스키마로 통일한다.
- trace 결과를 통해 “왜 스킵/감소/차단되었는지”와 “무엇을 바꿔야 하는지”를 일관되게 파악할 수 있게 한다.

## 진행 상황

- v1 타입(`src/types/option-trace.ts`)과 TraceBuilder 도입으로 이벤트/스킵 캡과 크기 상한을 적용.
- manage 입력 스키마에 `trace` 추가 및 manage 결과에도 v1 trace/effectiveOptions 제공.
- explore/understand/change/write/manage 모두 v1 스키마 적용.
- override/guardrail/파리티/스테일/레포 스코프 등 핵심 결정을 trace 이벤트/스킵으로 기록.
- trace 계약/회귀 테스트 및 TraceBuilder 단위 테스트 추가.

## 구현 상태

- [x] Phase A: v1 스키마 + manage trace 입력
- [x] Phase B: 5 pillars 적용
- [x] Phase C: trace 기반 계약/시나리오 테스트
