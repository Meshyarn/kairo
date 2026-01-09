# ADR-040: Five Pillars Toolset Consolidation (Explore-first)

**Status:** Implemented (curated)  
**Intent:** Reduce agent/tooling friction and token waste by collapsing “find + read” into a single pillar.

## Summary

Kairo exposes a small public tool surface (“Five Pillars”):

- `explore` — find + read (preview/section/full) with progressive disclosure
- `understand` — structure/relationships synthesis (optional deep includes)
- `change` — safe edits (plan/dry-run first; apply with guardrails)
- `write` — create/scaffold files (optionally generation-assisted)
- `manage` — state/undo/redo/reindex/history/test

The key change is **`explore` replaces separate “navigate/read” concepts** so agents can perform the natural loop:
search → preview → expand sections → full read (only when necessary), without repeated round trips.

## Decision

1) Public MCP tools are limited to the Five Pillars above.  
2) `explore` is the default entry point for discovery and reading:
   - Token-safe by default (`preview` / `section`)
   - Full reads require explicit intent (`view=full` or `fullPaths`)
   - Evidence reuse is supported via `packId` / cursors when applicable
3) Sensitive/binary/glob reads require explicit opt-in flags.

## Rejected alternatives

- Keep separate `navigate` + `read` tools: rejected because it increases round trips and duplicates “find then fetch” logic.
- Add many specialized public tools: rejected to keep MCP integration stable and predictable across clients.
- Default to “return everything”: rejected because it blows token budgets and makes outcomes less controllable.

## Revisit criteria

Revisit the public surface only if a new capability cannot be expressed as an option/mode of the existing Five Pillars without harming clarity.

## Implementation notes (current repo)

Tool registration and the public input schemas live in:

- `src/server/SmartContextServer.ts` (tool list + JSON Schemas)

Pillars are executed through the orchestration layer:

- `src/orchestration/OrchestrationEngine.ts`

Explore orchestration and formatting:

- `src/orchestration/pillars/explore/ExplorePillar.ts`
- `src/orchestration/pillars/explore/ResultFormatter.ts`

## Practical guidance

- Treat `explore` as the default “read API”:
  - Start with `view=preview` or `view=section`
  - Escalate to `view=full` only for the specific file(s) you need
- Use `manage` when results look stale:
  - `manage({ command: "reindex" })`
