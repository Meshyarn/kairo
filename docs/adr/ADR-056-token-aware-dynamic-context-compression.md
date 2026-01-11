# ADR-056 (Summary): Token-Aware Dynamic Context Compression

**Status:** Implemented (0.4.3 baseline)
**Date:** 2026-01-11
**Related:** `docs/adr/ADR-043-adaptive-context-architecture.md`, `docs/adr/ADR-055-universal-parity-and-standardization.md`

## Why
기존 `maxChars` 기반 하드 커팅은 실제 모델 토큰 소비량과 불일치하고(언어/밀도 차이), 코드/문서가 “문장/블록 중간에서” 끊겨 에이전트 오판과 재호출을 유발했다.

## What shipped
- **Token-first 예산:** `limits.maxTokens` 지원(Explore/Understand/Read), `maxChars`와 함께 주어지면 둘 다 만족(더 빡센 제한 적용)
- **Elastic truncation:** 토큰 기준 절단 시 “블록/문단/문장 경계” 근처에서 자르도록 완화(± window)
- **Distill(LOD 하향):** 예산 초과 시 일부 full content를 preview/skeleton로 다운그레이드(Explore), skeleton은 digest로 축약(Understand)
- **표준 degraded:** 예산으로 축약되면 `degraded: true` + `reasons: ["budget_exceeded"]` + `compression` 메타데이터 제공

## How to use
- 예산 지정:
  - `explore({ ..., limits: { maxTokens: 8000 } })`
  - `understand({ ..., limits: { maxTokens: 6000 } })`
  - `read({ ..., limits: { maxTokens: 4000 } })`
- 서버 기본값(환경변수):
  - `KAIRO_DEFAULT_MAX_TOKENS`
  - `KAIRO_EXPLORE_MAX_TOKENS`, `KAIRO_UNDERSTAND_MAX_TOKENS`, `KAIRO_READ_MAX_TOKENS`
- 토큰 추정기 선택:
  - `KAIRO_TOKEN_ESTIMATOR=whitespace`(기본) 또는 `KAIRO_TOKEN_ESTIMATOR=chars`

## Output signals
- `degraded: true` + `reasons`/`degradedReasons`에 `budget_exceeded`
- `compression`:
  - `mode: "truncate" | "distill"`
  - `maxTokens`, `estimatedTokens`, `usedChars`
  - (가능한 경우) `decisions`로 어떤 항목이 LOD 하향되었는지 표시

## Key code paths
- Token budget core: `src/orchestration/TokenBudget.ts`
- Explore: `src/orchestration/pillars/explore/ExplorePillar.ts`
- Understand: `src/orchestration/pillars/UnderstandPillar.ts`
- Read: `src/orchestration/pillars/ReadPillar.ts`
- Bench: `benchmarks/token-compression.ts`

