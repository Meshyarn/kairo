# ADR-053-C: Managed Config Bootstrap

**Status:** Implemented  
**Date:** 2026-01-10  
**Related:** `docs/adr/ADR-053-H-universal-hybrid-architecture.md`, `docs/adr/ADR-053-L-language-support-levels.md`, `docs/guides/configuration.md`

ADR-053-C adds `manage init` and `manage doctor` to generate a workable config skeleton and diagnose gaps without forcing users to hand-author `.kairo/config/.mcp-config.json` and related files. The flow is scan → plan → optional apply, with host config changes presented as patch suggestions by default.

## Decision

- Provide **two commands** under `manage`: `init` (bootstrap) and `doctor` (diagnose).
- Default to **plan** (non-destructive); `apply` is explicit.
- Detect repo layout, language mix, and WASM/query-pack gaps to recommend config + env hints.
- Preserve existing config by default with optional backups and merge/patch behavior.

## Implemented Architecture

- **ConfigBootstrapper** builds plan/apply output for:
  - `.kairo/config/.mcp-config.json`
  - `.kairo/config/languages.json`
  - `.vscode/mcp.json` (plan-only by default)
  - optional legacy `.mcp-config.json` guidance
- `manage` routes `init`/`doctor` to `project_manage` handler for consistent API surface.
- Results include `summary`, `findings`, and file-level **write plan** details.

## Behavior Notes

- `doctor` supports scoped checks (config/languages/wasm/host) to keep output focused.
- `init` can generate VS Code MCP plan entries without forcing host changes.
- Conflicts trigger safe failures unless `apply` + backup is enabled.
