# ADR-053-L (Summary): Language Support Levels (L2/L3)

**Status:** Implemented (2026-01-10)

## Context
Kairo is expanding beyond TS/JS and needs an explicit, testable quality bar per language.
This ADR defines support levels, a target language matrix, and the policy rules that govern
validation, degraded responses, and edit safety.

## Decision
Introduce L2/L3 support levels and enforce them at runtime:

- **L2 (Understand-grade):** reliable structure extraction + explicit degraded warnings.
- **L3 (Edit-safe):** deterministic syntax validation, required query packs, and hard blocking
  when validation or language support fails.

Support levels are mapped by `languageId` and applied via a policy table, not a new capability.

## Target Matrix
**L3 guaranteed:** Python, JavaScript/TypeScript, Java, Go, Rust, PHP, SQL

**L2 guaranteed:** C/C++, C#, Markdown/docs

## Implementation Highlights
- **Language support policy:** `src/config/LanguageSupportLevels.ts`
- **Validation enforcement:** `src/engine/validators/syntax-validator.ts` blocks L3 languages
  when language support or validation fails.
- **Guardrails:** `src/orchestration/guardrails/IntegrityGuardrails.ts` warns for L2 edits and
  blocks L3 when required queries are missing.
- **Degraded responses:** explore/understand emit explicit degraded reasons on missing queries.
- **Query packs + assets:** SQL query packs + WASM asset registered; C/C++/C# L2 packs in place.
- **Validation tooling:** `scripts/validate-language-support.ts` + `npm run validate:languages`.
- **Test coverage:** per-language fixtures + extraction/syntax tests under `src/tests/languages/`.
- **Docs:** `docs/guides/language-support.md` describes levels, matrix, and onboarding.

## Notes
- Language IDs may differ from file extensions (e.g., `.js/.tsx` use the `typescript` query pack).
- SQL remains L3 for syntax and structure, but schema semantics are out of scope.
