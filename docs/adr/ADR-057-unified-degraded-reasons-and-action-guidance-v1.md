# ADR-057: Unified `degradedReasons` & Action Guidance v1

**Status:** Implemented  
**Date:** 2026-01-12  
**Related:** `docs/adr/ADR-055-universal-parity-and-standardization.md`, `docs/adr/ADR-056-token-aware-dynamic-context-compression.md`

## Summary

Kairo의 “불완전함(degraded/blocked)” 신호를 `degradedReasons[]`로 표준화하고, 다음 행동은 문자열이 아니라 `actionToolCall`/`actionId`로 제공한다.

## Decision (v1 Contract)

### Degraded reasons

- `degradedReasons[]`는 불완전함의 **1급 진실(source of truth)** 이다.
- `reasons: string[]`는 레거시/내부 raw code 호환을 위해 유지한다.

```ts
export type DegradedReasonV1 = {
  type: DegradedReasonType;
  message: string;
  languageId?: string;
  filePath?: string;
  packageName?: string;
  actionToolCall?: { tool: string; args: Record<string, unknown> };
  actionId?: string;
};
```

### Guidance / suggested actions

- `guidance.suggestedActions[]`는 항상 toolCall 기반(v1)으로 제공한다.
- doctor 제안은 `actionToolCall`/`actionId`에서 파생하며, 문자열 파싱에 의존하지 않는다.

## Implementation Notes

- Degraded reason 매핑 단일화: `src/orchestration/DegradedReasonMapper.ts`
- Guidance 생성: `src/orchestration/GuidanceGenerator.ts`
- Pillar/리포트/flow artifacts suggestedActions 정렬: `src/orchestration/pillars/*`, `src/types/flow-artifacts.ts`

## Testing

- 매퍼 유닛 테스트: `src/tests/orchestration/DegradedReasonMapper.test.ts`
- 대표 degraded 계약 테스트(예: missing_query_pack, budget_exceeded): `src/tests/orchestration/*`
