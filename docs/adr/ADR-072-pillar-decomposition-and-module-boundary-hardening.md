# ADR-072 (요약): Pillar 분해 & 모듈 경계 강화

**Status:** Implemented (Phase A/B/C)

## 의도

- pillar 내부를 입력 정규화/계획/수집/결정/포맷/후처리로 분리해 테스트 가능한 경계를 고정한다.
- 외부 스키마/동작은 유지하고 내부 구조만 정리한다.

## 진행 상황

- Read: Input/Formatter 모듈 분리로 기본 파이프라인 경계 생성.
- Explore/Understand/Change/Write: InputNormalizer 도입(초기 파싱/옵션 정규화 분리).
- 공통 WorkflowMeta 유틸을 `pillars/shared`로 이동해 Change/Write에서 재사용.
- Override 결정 로직을 공유 Decision 모듈로 분리하고 단위 테스트 추가.
- Explore 예산/압축 결정 로직을 Decision 모듈로 분리하고 단위 테스트 추가.
- Understand 결정(그래프/압축/fallback) 로직을 Decision 모듈로 분리하고 단위 테스트 추가.
- Change/Write 가드레일 결정(Integrity guardrails) 로직을 Decision 모듈로 분리하고 단위 테스트 추가.
- Decision 모듈 타이밍 계측 추가(override/guardrail/budget/compression).
- Guardrails 평가 타이밍 계측 추가(`evaluateIntegrityGuardrails`).

## 구현 상태

- [x] Phase A: 공통 유틸/빌더/포맷터 분리
  - [x] Read Input/Formatter 분리
  - [x] Explore/Understand/Change/Write InputNormalizer
  - [x] Composer 축소 + 공통 유틸 이동
- [x] Phase B: 결정 로직 모듈화 + 테스트
  - [x] Override 결정 모듈 분리 + 테스트 추가
  - [x] Explore 예산/압축 결정 모듈 분리 + 테스트 추가
  - [x] Understand 결정(그래프/압축/fallback) 모듈 분리 + 테스트 추가
  - [x] Change/Write 가드레일 결정 모듈 분리 + 테스트 추가
- [x] Phase C: 핫 경로 경계 확정 + 계측
  - [x] Decision 모듈 타이밍 계측 추가
  - [x] Guardrails 평가 타이밍 계측 추가
  - [x] 모듈 단위 병목 측정/최적화 루프(벤치 스크립트 추가)

## 계측 확인

- `KAIRO_METRICS_MODE=detailed`로 실행 후 `manage`의 `metrics` 명령을 호출하면 `decision.*` 및 `guardrails.integrity_total_ms` 히스토그램을 확인할 수 있다.
- 로컬 벤치: `npm run benchmark:adr-072-metrics` (스냅샷은 `benchmarks/reports/`에 저장)
