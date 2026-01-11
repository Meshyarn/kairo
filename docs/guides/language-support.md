# Language Support Levels (L2/L3)

This guide explains Kairo's language support tiers and what you can expect per language.

## Support Levels

### L2 (Understand-grade)
- Stable structure extraction (imports/symbols/skeleton) for navigation.
- Best-effort parsing; degraded signals are expected on gaps.
- Edits are allowed but should emit degraded warnings.

### L3 (Edit-safe)
- Syntax validation is required and blocking on failure.
- Structure extraction is reliable enough for impact analysis.
- Edit flows should be safe-by-default with guardrails.
- Missing query packs or parser assets should block L3 flows and surface degraded reasons with guidance.

## Current Target Matrix

L3: Python, JavaScript, TypeScript, Java, Go, Rust, PHP, SQL  
L2: C/C++, C#, Docs (Markdown and similar document formats)

## How to Add a Language

1) Add file extension mapping in `src/config/LanguageConfig.ts`.
2) Add query packs under `src/queries/<languageId>/`:
   - `imports.scm`, `exports.scm`, `symbols.scm`, `skeleton.scm`
3) Provide a tree-sitter WASM at `wasm/tree-sitter-<languageId>.wasm` (or set `KAIRO_WASM_DIR`).
4) Register support level in `src/config/LanguageSupportLevels.ts`.
5) Run `npm run validate:languages`.
6) Run `npm run validate:parity` and (recommended) `npm test -- LanguageParity`.

## Promotion to L3

Move an L2 language to L3 once:
- Syntax validation exists and blocks invalid edits.
- Required query packs are present.
- Tests cover imports/exports/symbols/skeleton.

## Troubleshooting

- Parser fails to load: ensure `wasm/tree-sitter-<languageId>.wasm` exists or set `KAIRO_WASM_DIR`.
- Query pack missing: confirm `src/queries/<languageId>/` includes `imports/exports/symbols/skeleton`.
- Validation degraded: check `npm run validate:languages` for missing assets.
- Guidance mentions a `manage doctor` action when parity/language assets are missing.

## Useful diagnostics

- `manage({ command: "doctor", scope: "languages" })`: languageId/extension mapping issues
- `manage({ command: "doctor", scope: "parity" })`: query packs + WASM grammar availability (policy-aware)
