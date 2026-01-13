# ADR-061: Language Parity Gates (L2/L3) & Silent-pass 제거

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-055-universal-parity-and-standardization.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/plans/loadmap.md`

## Summary

L2/L3 언어 parity 요구사항을 단일 게이트로 통합하고, missing query/wasm/validator를 typed degradedReasons로 표준화하여 silent-pass를 제거한다. L3 apply는 parity 실패 시 block, L2는 degraded 신호를 유지한다.

## Decision (v1 Contract)

- `LanguageParityMatrix`를 source of truth로 사용한다(L2/L3 + required assets + requiredQueries).
- `LanguageParityGate`가 read/understand/change/write 경로에서 동일한 parity 판단을 제공한다.
- missing query/wasm/validator는 `degradedReasons`로 노출하며 L3 apply는 block한다.
- Explore는 L3에서 **구문 오류/쿼리팩 누락은 block**, **WASM/validator 미가용은 degraded**로 처리해 “탐색은 최대한 계속” 원칙을 지킨다.

## Implementation Notes

- Parity gate 도입: `src/config/LanguageParityGate.ts`
- Parity matrix 확장(requiredQueries): `src/config/LanguageParityMatrix.ts`
- Support level 파생: `src/config/LanguageSupportLevels.ts` (L2/L3 정렬)
- L3 apply block + L2 degraded: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`
- Silent-pass 제거: `src/engine/validators/syntax-validator.ts`, `src/engine/editor/EditExecution.ts`, `src/ast/LanguageSupportSignals.ts`
- Degraded reason 확장: `src/types/tool-responses.ts`, `src/orchestration/DegradedReasonMapper.ts`
- validate-parity/doctor 정합: `scripts/validate-parity.ts`, `src/config/ConfigBootstrapper.ts`

## Implementation Status (현 코드 기준)

- [x] Phase A: missing wasm/query를 typed degradedReasons로 표준화
- [x] Phase B: L3 apply에서 validator/parity 불가 시 block + downgrade 제거
- [x] Phase C: 언어 온보딩 체크리스트/문서/테스트 정합(guide + parity scripts)

## Testing

- `npm test -- LanguageParity`
- `npm run validate:parity`
