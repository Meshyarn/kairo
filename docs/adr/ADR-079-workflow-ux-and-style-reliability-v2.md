# ADR-079 (요약): Workflow UX & Style Reliability v2

## 의도

- `status/doctor`에서 “현재 상태/다음 행동”을 요약 제공해 작업 흐름을 명확히 한다.
- `change(plan)` 실패 시 구조화 입력으로 즉시 전환할 수 있게 코칭을 제공한다.
- StylePack을 근거 기반(참조/설정 감지)으로 강화하고, formatter는 옵트인으로 연결한다.

## 진행 상황

- `manage status/doctor` 요약에 `currentSession`, `artifactSummary`, `recommendedActions`를 제공한다.
- `change(plan)` 실패 시 `schemaCoaching`(requiredFields/editsTemplate/helpUrl 등)를 포함한다.
- StylePack에 `references`, `configDetections`, `confidence` 메타를 추가한다.

## 구현 상태

- [x] Phase A: status/doctor 요약 + change(plan) 코칭 + StylePack v2 메타
- [x] Phase B: artifacts/sessions UX 정렬 + style check 결합(기본 blockOn에서 vibe 제외)
- [x] Phase C: formatter bridge + style drift doctor 노출

## 설정 메모

- formatter bridge는 opt-in이며 `options.formatter`, `KAIRO_FORMATTER_MAX_FILES`로 제어한다.
- undo/rollback 정합을 위해 기본적으로 포맷 적용을 스킵하며, 필요 시 `KAIRO_FORMATTER_ALLOW_UNTRACKED=true`로 허용한다.
