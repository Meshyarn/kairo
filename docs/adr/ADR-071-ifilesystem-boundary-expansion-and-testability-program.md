# ADR-071 (요약): IFileSystem 경계 확장 & 테스트 가능성 강화

**Status:** Implemented (Phase A/B/C)

## 의도

- 코어 로직(오케스트레이션/핸들러)이 `fs`를 직접 호출하지 않고 `IFileSystem`을 통해 파일 I/O를 수행하도록 경계를 확장한다.
- Memory-first 테스트를 통해 디스크 의존/플레이키/플랫폼 드리프트를 줄인다.
- “fs 직접 import 금지”를 스크립트로 검증해 재유입을 방지한다.

## 이번 반영(Phase A~C)

- `src/orchestration/**`, `src/handlers/**`에서 `fs` 직접 import 제거(플랫폼 어댑터는 예외).
- `HandlerContext.fileSystem`을 `IFileSystem`으로 통일.
- 오케스트레이션 구성요소들이 필요 시 `IFileSystem`을 주입받거나 `NodeFileSystem`을 내부 기본값으로 사용.
- Drift guardrail 스크립트 추가로 Phase A 범위에서 `fs` import를 차단.
- `src/indexing/**` 경계 확장(어댑터화 + persistence 테스트 보강).
- `src/ast/**` 경계 확장(리졸버/그래프 포함) + 회귀 테스트 보강.

## 검증/테스트

- `npm run validate:fs`로 Phase A 경계 위반 검증(엄격 모드).
- `npm run validate:fs:b`로 Phase B 경계 위반 검증(엄격 모드).
- `npm run validate:fs:c`로 Phase C 경계 위반 검증(엄격 모드).
- `UnifiedContextGraph` persistence 경로에 대해 `MemoryFileSystem` 기반 저장/로드 테스트 추가.

## 구현 상태

- [x] Phase A: orchestration/handlers 경계 고정 + MemoryFS 테스트 + 검증 스크립트
- [x] Phase B: indexing 경계 확장(어댑터화 + 테스트)
- [x] Phase C: ast 경계 확장(리졸버/그래프 + 테스트)
