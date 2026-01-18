# ADR-074 (요약): Token Budget Allocator v2 + summary reuse

**Status:** Implemented (Phase A/B/C)

## 의도

- Explore/Understand의 예산 배분을 섹션별 계획(Plan)으로 표준화해 응답 크기/구성을 안정화한다.
- 예산이 부족할 때 truncate 대신 요약/재사용 전략을 우선 적용한다.
- allocator 결정(배분/스킵/요약 선택)을 decisionTrace에 기록한다.

## 진행 상황

- TokenBudgetAllocator v2 도입(`src/orchestration/budget/TokenBudgetAllocatorV2.ts`).
- Explore/Understand에서 BudgetPlan 생성 및 섹션 전략 적용.
  - Explore 문서 확장은 plan 전략에 따라 raw/preview/summary 모드로 변경.
  - Understand는 graph/analysis/style 섹션을 plan 기반으로 omit/요약 처리.
- allocator 결정은 decisionTrace 이벤트(`allocator.*`)로 기록.
- allocator 단위 테스트 + allocator 이벤트 allowlist 테스트 추가.

## 구현 상태

- [x] Phase A: allocator + trace 연동
- [x] Phase B: Understand 적용
- [x] Phase C: Explore 확장 적용
