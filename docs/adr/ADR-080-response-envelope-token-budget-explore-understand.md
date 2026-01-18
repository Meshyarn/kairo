# ADR-080 (Summary): Explore/Understand Response Envelope Token Budget

**Status:** Implemented (0.4.x baseline)  
**Date:** 2026-01-18  
**Related:** `docs/adr/ADR-056-token-aware-dynamic-context-compression.md`, `docs/adr/ADR-074-token-budget-allocator-v2-cross-pillar-summary-reuse.md`, `docs/adr/ADR-073-option-trace-standardization-decisiontrace-effectiveoptions.md`

## Why
`explore`/`understand`는 내부적으로 토큰 예산(텍스트 truncate/distill)을 적용하고 있었지만, **최종 tool output JSON(응답 envelope)** 전체 크기는 일관되게 제한되지 않았다.  
특히 `understand(include.callGraph=true)`는 call graph가 노드/엣지 배열로 커지면서 응답이 폭발할 수 있어 컨텍스트 오버플로/비용/UX 리스크가 컸다.

## What shipped
- **`limits.maxTokens` 의미 고정:** `limits.maxTokens`는 **최종 응답 JSON의 토큰 상한**으로 해석한다.
- **Two-pass budget enforcement:**
  - (A) 섹션 계획(allocator v2)으로 생성 단계에서 downshift/omit 우선 적용
  - (B) 생성 후 **응답 envelope 기준**으로 한 번 더 감쇠(ladder) 적용
- **Call graph 분리(Progressive disclosure):**
  - `understand` base response는 token-safe한 `callGraph` 요약 shape를 유지
  - 전체/상세 graph는 **graph artifact**로 분리(`callGraphArtifactId`, `callGraphSummary`)
  - `manage({ command: "artifact", target: callGraphArtifactId, detail: "summary" | "full" })`로 조회
- **Explainability:** `compression` + `degradedReasons` + `decisionTrace`로 “왜 줄었는지/무엇이 줄었는지”를 추적 가능하게 함

## How to use
- 응답 envelope 예산 지정:
  - `explore({ ..., limits: { maxTokens: 8000 } })`
  - `understand({ ..., limits: { maxTokens: 6000 } })`
- call graph 확장(요약 + artifact):
  - `understand({ goal: "SomeSymbol", include: { callGraph: true } })`
  - 이후 `manage({ command: "artifact", target: callGraphArtifactId, detail: "summary" })`
- 참고: `limits.maxTokens`는 “텍스트 일부”가 아니라 **최종 JSON 전체**가 기준이다.

## Output signals
- `degraded: true` + `reasons/degradedReasons`에 `budget_exceeded` (또는 관련 감쇠 사유)
- `compression`:
  - `applied`, `mode`, `decisions`(가능한 경우)
- `decisionTrace`:
  - budget/omit/downshift 이벤트 및 최종 적용 여부

## Key code paths
- Response envelope budgeter: `src/orchestration/budget/ResponseEnvelopeBudgeter.ts`
- Explore post-pass enforcement: `src/orchestration/pillars/explore/ExplorePillar.ts`
- Understand graph artifact + enforcement: `src/orchestration/pillars/UnderstandPillar.ts`
- Graph artifacts types: `src/types/flow-artifacts.ts`
- Manage artifact view: `src/handlers/ManageHandlers.ts`

