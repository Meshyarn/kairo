# ADR-047: Multi-Repo & Multi-Language Expansion

**Status:** Implemented (curated)  
**Intent:** Support real-world workspaces where code spans multiple repos and multiple languages.

Multi-repo support adds explicit repository boundaries and configuration so `kairo` can:

- index multiple roots under one “workspace”
- keep per-repo settings (languages, exclusions, edit permissions)
- still provide a unified “search + understand + change” experience

## Decision

1) Multi-repo config file:

- Primary: `.kairo/config/.mcp-config.json`
- Legacy (supported): `.kairo/config/mcp-config.json` or `.mcp-config.json` at workspace root
- Migration helper: `npm run migrate:mcp-config`

2) Repo registry chooses a default repo and resolves “which repo a path belongs to”.

3) Multi-language support is query-pack based (ADR-044) and can be customized per workspace via:

- `.kairo/config/languages.json` (recommended)
- `.kairo/languages.json` (legacy)

## Implementation notes (current repo)

- Repo config and resolution:
  - `src/config/RepoRegistry.ts`
  - `src/scripts/migrate-mcp-config.ts` (invoked via `npm run migrate:mcp-config`)
- Per-repo storage layout is under `.kairo/` using `PathManager` helpers:
  - `src/utils/PathManager.ts`

## Practical guidance

- Start in single-repo mode; add `.kairo/config/.mcp-config.json` only when you need explicit multi-root behavior.
- Keep cross-repo edits opt-in; treat them as a deliberate escalation.
