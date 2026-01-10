# ADR-044: Universal Language Parity via Tree-Sitter WASM

**Status:** Partially implemented (curated)  
**Intent:** Make “non-TypeScript” languages first-class by using a query-driven extraction pipeline instead of TS-specific logic.

## Summary

Universal language parity means:

- imports/exports/symbols/skeleton extraction is driven by **tree-sitter query packs** (`.scm`)
- the same high-level capabilities work across languages (within practical limits)
- adding a new language is primarily a matter of adding query files + a mapping entry

Language “parity” should be interpreted via explicit support levels (L2/L3); see `docs/adr/ADR-053-L-language-support-levels.md`.

## Decision

1) Adopt a **query-driven architecture**:
   - `queries/<languageId>/*.scm` defines extraction behavior
2) Prefer **web-tree-sitter WASM** for portable parsing.
3) Keep fallbacks (regex/heuristic) where necessary, but make them explicit.

## Rejected alternatives

- Per-language bespoke parsers as the default: rejected because it does not scale across languages and increases maintenance cost.
- Mandatory LSP/toolchains for parity: rejected/deferred due to dependency and operational complexity (see `docs/adr/ADR-046-semantic-validation-layer.md`).
- “One universal extractor that perfectly matches all languages”: rejected; parity is practical and incremental, with explicit limits.

## Revisit criteria

Revisit LSP/toolchain integration only as an optional plugin-style path that does not become a core dependency.

## Implementation notes (current repo)

Query packs:

- `src/queries/*` → copied to `dist/queries/*` during build

Language mapping configuration:

- Built-ins + user overrides: `src/config/LanguageConfig.ts`
- User config file (recommended): `.kairo/config/languages.json`
- Legacy file: `.kairo/languages.json`

Parsers/backends:

- `src/ast/WebTreeSitterBackend.ts`
- `src/ast/extraction/*` (universal extractors)

## Practical guidance

- If a language behaves poorly:
  - confirm its query pack exists under `src/queries/<languageId>/`
  - override the mapping in `.kairo/config/languages.json`
