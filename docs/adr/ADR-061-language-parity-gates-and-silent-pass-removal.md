# ADR-061: Language Parity Gates (L2/L3) & Silent-pass Removal

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-055-universal-parity-and-standardization.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`

## Summary

Unify L2/L3 language parity requirements under a single gate, and standardize missing query/wasm/validator signals as typed `degradedReasons` to eliminate silent-pass behavior. L3 apply is blocked on parity failure, while L2 keeps a degraded signal.

## Decision (v1 Contract)

- Use `LanguageParityMatrix` as the source of truth (L2/L3 + required assets + requiredQueries).
- `LanguageParityGate` provides consistent parity decisions across read/understand/change/write paths.
- Expose missing query/wasm/validator as `degradedReasons`, and block L3 apply when parity cannot be satisfied.
- In Explore (L3), **syntax errors/missing query packs block**, while **missing WASM/validators degrade**, to preserve the “keep exploring when possible” principle.

## Implementation Notes

- Parity gate: `src/config/LanguageParityGate.ts`
- Parity matrix extension (requiredQueries): `src/config/LanguageParityMatrix.ts`
- Support-level derivation: `src/config/LanguageSupportLevels.ts` (L2/L3 alignment)
- L3 apply block + L2 degraded: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`
- Silent-pass removal: `src/engine/validators/syntax-validator.ts`, `src/engine/editor/EditExecution.ts`, `src/ast/LanguageSupportSignals.ts`
- Degraded reason extensions: `src/types/tool-responses.ts`, `src/orchestration/DegradedReasonMapper.ts`
- validate-parity/doctor alignment: `scripts/validate-parity.ts`, `src/config/ConfigBootstrapper.ts`

## Implementation Status (as of current code)

- [x] Phase A: standardize missing wasm/query as typed degradedReasons
- [x] Phase B: block L3 apply when validator/parity is unavailable + remove silent downgrades
- [x] Phase C: align language onboarding checklist/docs/tests (guide + parity scripts)

## Testing

- `npm test -- LanguageParity`
- `npm run validate:parity`
