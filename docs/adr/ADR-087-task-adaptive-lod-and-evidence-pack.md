# ADR-087: Make `task` Production-Grade via Adaptive LOD + Evidence Packs

**Status:** Implemented  
**Date:** 2026-01-23  
**Full design (canonical):** `.archive/ADR-087-task-adaptive-lod-and-evidence-pack.md`  
**Related:** `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md`, `docs/adr/ADR-086-task-compact-change-write-verify.md`, `docs/adr/ADR-080-response-envelope-token-budget-explore-understand.md`, `docs/adr/ADR-059-evidence-pack-and-summaries-lifecycle-prune-compact.md`, `docs/adr/ADR-064-fileversion-handshake-read-apply.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`

## Summary

In `publicSurface=compact`, hosts usually only expose `task` + `manage`. This is the right public surface, but real usage showed `task` often returned outputs that were **too shallow to be decision-sufficient**, causing agents to fall back to manual repo probing (rg/ls/cat) outside the Kairo tool surface.

ADR-087 upgrades `task` into a budget-aware orchestration layer that:
- chooses the right internal pillars (`explore/understand/change/write/verify`) for the request,
- returns **bounded, decision-sufficient evidence** (inline) and an **Evidence Pack artifact** (for depth),
- enforces response envelopes (`output.maxTokens/maxChars`) via a deterministic LOD downshift order,
- and keeps apply safety intact (no silent apply; handshake remains required).

## Decision

### 1) Budget-aware multi-step `task` (read-only composites)

`task` can internally compose multiple read-only steps (e.g., `explore → understand`) when the initial evidence is insufficient and budget allows, returning `status="partial_success"` plus deterministic `guidance.nextCalls` to continue.

### 2) Evidence Pack artifact (`type: "evidence"`)

For deep requests (and when needed for progressive disclosure), `task` stores an evidence pack artifact with ranked files + bounded excerpts + reasons. The artifact is retrievable via:

- `manage({ command: "artifact", target: "<evidenceId>", detail: "summary" | "full" })`

### 3) Adaptive LOD + response envelope enforcement

`task` interprets `budget` as a policy bundle (step count + evidence caps + default LOD), then enforces `output.maxTokens/maxChars` on the final `task` response (dropping `details`, trimming evidence, dropping `decisionTrace`, etc. deterministically).

### 4) Change/write prep assist (anchor candidates + similar-file evidence)

To reduce “need to read file manually to craft edits”:
- `plan_change` without `edits` returns prep hints and bounded `targetStringCandidates` when safe anchors are available.
- `write(plan)` without an explicit code block can gather similar-file evidence before drafting.

### 5) Apply follow-up verification (cheap, internal)

After successful apply flows (`task(mode="apply_change")` and `task(mode="write", safety="apply")`), `task` performs an internal consistency check when possible and embeds a `verification` summary in the response (no external test runner).

## Implementation notes (this repo)

- `task` orchestration (LOD, decision gate, composites, apply auto-verify): `src/handlers/TaskHandlers.ts`
- Evidence pack type + session wiring: `src/types/flow-artifacts.ts`, `src/orchestration/flow-artifact-manager.ts`
- Evidence pack builder (ranked files/excerpts/anchors): `src/orchestration/task/TaskEvidenceBuilder.ts`
- Final response envelope enforcement: `src/orchestration/budget/ResponseEnvelopeBudgeter.ts`
- Evidence pack retrieval (`manage artifact`): `src/orchestration/pillars/ManagePillar.ts`

## Consequences

- Compact mode becomes practical for real work: depth is obtained via evidence packs rather than exposing pillar tools.
- Agents are guided toward Kairo-native follow-ups (`task/manage`) instead of external shell probing.
- Apply safety invariants remain unchanged (handshake/token gated applies; verify is non-destructive).
