# ADR-086: Expand `task` to Support `write`/`verify` in `publicSurface=compact`

**Status:** Implemented  
**Date:** 2026-01-22  
**Related:** `docs/adr/ADR-050-writers-flow.md`, `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-064-fileversion-handshake-read-apply.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`

## Summary

In `publicSurface=compact`, hosts typically only call `task` and `manage`.

Before ADR-086, `task` could route `ask/analyze/plan_change/apply_change`, but `mode="write"` and `mode="verify"` were blocked. This prevented the Writer’s Flow loop (**plan → apply → verify**) from closing on the compact surface and caused “drafts are produced but cannot be applied” UX failures, especially when guidance suggested calling tools (`change`, `write`) that may not be exposed to the host.

ADR-086 makes `task` a true wrapping layer over existing pillars (not a new capability expansion): it wires `write` and `verify` through `task`, and rewrites action guidance to only use `task/manage` in compact mode.

## Decision

### 1) Enable `task(mode="write")`

`task` can execute the internal `write` pillar and return:
- `draftId` + `applyToken` (plan)
- apply results (apply)

Input mapping:
- Target selection: `targetFiles[0]` → `targetPath` (primary), with a `targetPath` compat alias and a fallback to `paths[0]`.
- Content: extracted from a fenced code block in `request` (e.g. ```ts … ```). If absent, plan mode uses smart generation (`smartWrite=true`) to draft.
- Apply handshake: apply requires `draftId + applyToken` when `applyHandshake.required=true` (MCP default).

### 2) Enable `task(mode="verify")`

`verify` is a lightweight validation step that:
- Reads the current file and (when `draftId` is provided) compares it to the draft pack’s phantom content (`Draft match`).
- Optionally reports a **base drift** signal (`Base version`) against the pre-apply snapshot when draft content does not match.

`verify` does not run external test commands; it reports a compact result + next steps using degraded reasons.

### 3) Rewrite guidance to be compact-executable

When `publicSurface=compact`:
- Suggested `change` tool calls are rewritten into `task(mode="plan_change"| "apply_change")`.
- Suggested `write` tool calls are rewritten into `task(mode="write")`.
- `manage` tool calls remain unchanged.

This prevents guidance from recommending tools the host cannot call.

## Implementation notes (this repo)

- `task` routing + compact guidance rewrite: `src/handlers/TaskHandlers.ts`
- Write intent classification for `task(mode="auto")`: `src/orchestration/IntentRouter.ts`
- `task` schema updates (compat `targetPath`): `src/server/tools/ToolSpecRegistry.ts`
- Apply handshake / applyToken consumption timing: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/change/BatchExecution.ts`, `src/orchestration/pillars/WritePillar.ts`
- Root/FS alignment for guardrails + module resolution: `src/utils/PathManager.ts`, `src/orchestration/guardrails/IntegrityGuardrails.ts`, `src/server/SmartContextServer.ts`

## Consequences

- Promptless `task` usage in compact mode now supports the full Writer’s Flow loop:
  - `plan_change → apply_change → verify`
  - `write(plan) → write(apply) → verify`
- Guidance is actionable by default in compact mode (no “call tool X which you can’t see” dead ends).
- The public tool schema remains stable and compact (ADR-058): advanced `write` options are still accessed via `pillars` surface or session policy, not by expanding `task` into a mega-tool.
