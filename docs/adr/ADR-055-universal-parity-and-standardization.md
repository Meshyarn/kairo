# ADR-055: Universal Parity & Standardization Program

**Status:** Implemented (0.4.0 baseline)  
**Date:** 2026-01-10  
**Related:** `docs/adr/ADR-044-universal-language-parity.md`, `docs/adr/ADR-053-H-universal-hybrid-architecture.md`, `docs/adr/ADR-053-L-language-support-levels.md`, `docs/adr/ADR-053-C-managed-config-bootstrap.md`, `docs/adr/ADR-054-cross-language-contract-awareness.md`

## Context

Kairo has historically delivered features first for TS/JS (and now Rust), leaving other languages in a `degraded` state or with uneven UX/safety guarantees. As the toolset grows, “language-specific implementations” become costly and lead to fragmented behavior across pillars.

ADR-055 defines a **standardization stage**: stable schemas, parity gates, and adapter/capability extension points that make future features naturally expand across L2/L3 languages rather than remaining TS/JS/Rust-only.

## What’s In 0.4.0 (Practical)

- **Degraded reason schema**: stable `degradedReasons[]` with typed reasons (missing query pack / missing WASM grammar / unsupported language / syntax validation failed, plus cross-language contract reasons).
- **Parity validation gates**:
  - `npm run validate:languages` (query pack + grammar + support-level policy checks)
  - `npm run validate:parity` (parity matrix checks + runtime validator availability)
- **Parity regression tests**: `npm test -- LanguageParity` validates L3 “syntax error blocks” and L2 “skeleton or degradedReasons”.
- **Boundary adapters + contracts**: unified boundary adapter registry + bootstrap into `.kairo/contracts/…` for cross-language impact awareness.
- **Field-level consumer linking (where feasible)**: unified field access indexing across TS + Go/Java/Rust/Python to populate `CrossLangImpact.fieldImpacts`.

## Decision

1) Treat “parity” as a **contract** (tool/feature requirements), not as “we support language X”.
2) Keep `ADR-053-L` support levels as the policy backbone:
   - **L2** = understand-grade with explicit degraded reasons.
   - **L3** = edit-safe with hard blocking when required support is missing.
3) Use `ADR-044` query packs + language mapping as the default parsing/extraction path.
4) Use `ADR-054` boundary adapters + contract manifests as the standard cross-language impact pipeline.
5) Standardize degraded reporting via a stable `degradedReasons` schema (append-only codes) to avoid silent or ambiguous degraded behavior.

## Implementation Plan (Phased)

- **Phase 0:** Freeze stable codes (degraded reason types + doctor finding codes) and define a parity matrix (requirements per languageId/support level), including root-fixed `.kairo/contracts` + `.d.ts`-based contract auto-generation as the baseline for boundary parity.
- **Phase 1:** Add `degradedReasons` to all tool responses (keep `degraded`/`reasons` for compatibility) and unify guidance generation.
- **Phase 2:** Add parity validation gates (`npm run validate:languages`-style) and `manage doctor --scope=parity|languages`.
- **Phase 3:** Expand boundary adapters beyond NAPI: `idl_proto`, `http_openapi`, `db_sql_schema` (start with file-level consumer linking).
- **Phase 4:** Improve consumer linking to symbol/field-level where feasible (fallback must be explicit `degradedReasons`).
- **Phase 5:** Add regression + performance gates (time budgets, lookup overhead, manifest load overhead).

## Success Criteria

- L3 languages never silently pass on missing query packs/validators/contract evidence: they either **block** or emit explicit `degradedReasons` + `manage doctor` guidance.
- Adding a new language is primarily a matter of **mapping + query pack + validation/backends**, validated by the parity gates.
- Cross-language impact is consistently reported via the boundary adapter pipeline (at least file-level; field-level where available), and consumer files are visible in the top-level impact summary.
