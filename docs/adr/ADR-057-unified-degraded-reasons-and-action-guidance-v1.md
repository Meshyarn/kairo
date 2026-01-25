# ADR-057: Unified `degradedReasons` & Action Guidance v1

**Status:** Implemented  
**Date:** 2026-01-12  
**Related:** `docs/adr/ADR-055-universal-parity-and-standardization.md`, `docs/adr/ADR-056-token-aware-dynamic-context-compression.md`

## Summary

Standardize Kairo’s “incompleteness” signals (`degraded`/`blocked`) via `degradedReasons[]`, and provide next actions via `actionToolCall`/`actionId` (not ad-hoc strings).

## Decision (v1 Contract)

### Degraded reasons

- `degradedReasons[]` is the **first-class source of truth** for incompleteness.
- `reasons: string[]` is retained for legacy/internal raw code compatibility.

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

- `guidance.suggestedActions[]` is always tool-call based (v1).
- Doctor suggestions are derived from `actionToolCall`/`actionId`, without relying on string parsing.

## Implementation Notes

- Single source of truth for degraded-reason mapping: `src/orchestration/DegradedReasonMapper.ts`
- Guidance generation: `src/orchestration/GuidanceGenerator.ts`
- Align suggestedActions across pillars/reports/flow artifacts: `src/orchestration/pillars/*`, `src/types/flow-artifacts.ts`

## Testing

- Mapper unit tests: `src/tests/orchestration/DegradedReasonMapper.test.ts`
- Representative degraded contract tests (e.g., missing_query_pack, budget_exceeded): `src/tests/orchestration/*`
