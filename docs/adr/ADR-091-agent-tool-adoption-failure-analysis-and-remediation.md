# ADR-091: Agent Tool Adoption Failure — Root Cause Analysis & Remediation

**Status:** Implemented (Phase 1–2)  
**Date:** 2026-02-13  
**Scope:** `kairo` repo — MCP server, tool schema, orchestration, budget, response pipeline  
**Related:** `ADR-057`, `ADR-058`, `ADR-080`, `ADR-084`, `ADR-086`, `ADR-087`, `ADR-088`, `ADR-090`

ADR-091 addresses a critical adoption failure: AI agents (Copilot, Claude, Codex, Gemini, etc.) consistently dismissed Kairo tools after 1–2 calls because the first call returned empty or degraded evidence. This ADR identifies 12 root causes and prescribes a phased remediation plan.

Full implementation details: `.archive/ADR-091-agent-tool-adoption-failure-analysis-and-remediation.md`

## Problem

When agents called `task({ request: "..." })` without specifying `budget`, the default preset `mcp-lean` applied tight token limits (explore 4,000 tokens, perStep 3s). This caused:

- Empty `evidence: []` arrays (zero useful code content)
- `status: "partial_success"` with `degraded: true`
- Recovery guidance referencing non-existent tool names (`project_search`, `project_manage`)
- `nextCalls` buried in deep JSON (missed by agents)

**Observed first-call success rate: ~10%** — after which agents abandoned Kairo permanently.

## Root cause categories (12)

| Cat | Problem | Agent impact |
|-----|---------|-------------|
| **A** | Default preset `mcp-lean` too restrictive | Empty evidence on first call |
| **B** | Aggressive truncation removes all evidence | Zero code content returned |
| **C** | 2-phase commit for any change | Agent switches to simpler tools |
| **D** | Tool descriptions too short (15 words) | Agents can't infer capabilities |
| **E** | `guidance.nextCalls` buried in deep JSON | Agents ignore next steps |
| **F** | Compact surface hides advanced features | No granular control |
| **G** | Legacy tool names in error recovery | Recovery calls fail |
| **H** | Schema too complex (80+ properties) | Agent confusion |
| **I** | Session TTL too short (30 min) | Silent token expiry |
| **J** | `doc_search_skipped` noise in responses | False failure signal |
| **K** | Native module hard dependency | Cold start crashes |
| **L** | Rich docs unreachable by agents | No self-discovery |

## Decision (principles)

- **ROI order:** ship high-impact budget/schema fixes first.
- **Additive only:** keep `compat` behavior (ADR-058).
- **Evidence floor:** never return empty evidence when search results exist.
- **Agent-facing parity:** all tool references in responses must match the public tool surface.

## Implemented work packages

### Phase 1 — First-call success rate (P0)

**Target: first-call useful rate ~10% → ≥60%**

#### WP1-1. Default MCP preset → `mcp-balanced`

Changed `McpModePresetRegistry.resolvePresetId()` to return `mcp-balanced` (was `mcp-lean`) for MCP mode. This gives agents explore 6,000 tokens, perStep 5s, and LOD 2 (excerpts) by default.

- Code: `src/orchestration/policy/McpModePresetRegistry.ts`

#### WP1-2. Default budget → `balanced`

Changed `normalizeBudget()` and `resolveTaskBudgetPolicy()` fallback from `lean` to `balanced`. Agents calling `task({ request: "..." })` without `budget` now get maxSteps=2, LOD=2, maxEvidenceItems=4.

- Code: `src/handlers/task/TaskRoutingUtils.ts`, `src/orchestration/policy/McpModePresetRegistry.ts`

#### WP1-3. Evidence floor (prevent empty arrays)

Added `MIN_EVIDENCE_ITEMS_FLOOR=1` constant. The shrink loop in `ResponseEnvelopeBudgeterTask` can no longer reduce evidence below this floor when search results exist. Excerpt fallback truncates to 120→40 chars instead of deleting.

- Code: `src/orchestration/budget/ResponseEnvelopeBudgeterConstants.ts`, `src/orchestration/budget/ResponseEnvelopeBudgeterTask.ts`

#### WP1-4. Tool descriptions expanded (≥50 words)

All public tool descriptions (`task`, `manage`, `explore`, `understand`, `change`, `write`) expanded to 50–100 words. Each description now includes mode/command overview and a `manage({command:'schema',tool:'...'})` self-documenting hint.

- Code: `src/server/tools/ToolSpecRegistryPillarA.ts`, `src/server/tools/ToolSpecRegistryPillarB.ts`

#### WP1-5. Legacy tool names removed from agent-facing output

All `project_search`, `project_manage`, `code_read`, `edit_apply`, `relationship_analyze` references in error recovery, degraded-reason guidance, and agent playbook patterns replaced with `task`/`manage`/`explore`/`change`/`understand`.

- Code: `src/errors/ErrorEnhancer.ts`, `src/orchestration/DegradedReasonMapper.ts`, `src/engine/AgentPlaybook.ts`

### Phase 2 — Response quality & workflow improvements (P1)

**Target: 2-call completion ≥80%, change completion ≥30%**

#### WP2-1. perStep timeout raised for `mcp-lean`

`mcp-lean` perStep: 3,000ms → 5,000ms. Prevents code-search timeout on normal-size repos.

- Code: `src/orchestration/policy/McpModePresetRegistry.ts`

#### WP2-2. AdaptiveLodController softened

Violation streak ≥2 no longer forces `targetLevel=0` (lean). Instead applies `Math.max(0, baseLevel-1)` — one step down instead of hard floor. Agents retrying with `budget="deep"` are no longer trapped at lean.

- Code: `src/orchestration/adaptive-flow/AdaptiveLodController.ts`

#### WP2-4. nextCalls promoted to response top-level

When `guidance.nextCalls` exists, it is now also placed at response top-level. Agents can find suggested next calls without navigating nested JSON.

- Code: `src/handlers/task/TaskGuidanceUtils.ts` (via `TaskResponseUtils.ts`)

#### WP2-6. autoPersist enabled + artifact TTL extended

`FlowArtifactManager` now uses `autoPersist: true` by default. LRU cache TTL extended from 30 minutes to 2 hours, preventing silent `applyToken` expiry during longer sessions.

- Code: `src/server/SmartContextServerBootstrap.ts`, `src/orchestration/flow-artifact-manager.ts`

#### WP2-7. manage command parameter documentation

`command` property now includes inline description of required parameters per command (e.g., `schema` requires `tool`, `doctor` takes `scope`).

- Code: `src/server/tools/ToolSpecRegistryPillarB.ts`

#### WP4-3. suggestedActions limit raised

`GuidanceGenerator` now returns up to 5 suggested actions (was 3).

- Code: `src/orchestration/GuidanceGenerator.ts`

## Verification

- TypeScript compilation: 0 errors
- In-process MCP server test (`scripts/adr-091-verify.mjs`): 22/24 PASS
- Direct MCP tool calls confirmed:
  - `task({request})` without budget → evidence: 4 items (was 0)
  - `manage({command:'schema',tool:'task'})` → full inputSchema
  - nextCalls promoted to top-level ✓
  - `apply_change` without token → blocked with recovery guidance ✓
  - 0 legacy tool names in any agent-facing response

## Consequences / impact

- **Higher first-call success:** agents receive actionable evidence on first `task()` call.
- **Lower abandonment:** `nextCalls` at top-level guides agents to useful follow-ups.
- **Correct recovery paths:** all guidance references match public tool names.
- **Longer sessions:** 2-hour TTL prevents silent draft/token loss.
- **Self-documenting tools:** 50+ word descriptions enable agent self-discovery.

## Follow-ups (Phase 3–4, deferred)

- WP3-1: `safety: "auto"` 1-shot change path (opt-in via `KAIRO_ENABLE_AUTO_APPLY`)
- WP3-2: MCP `resources/list` agent document registration
- WP3-3: `task` pillarOptions passthrough for compact surface
- WP3-4: Response structure cleanup (contract metadata opt-in, Map/Set serialization)
- WP3-5: `profile`/`budget`/`depth` terminology unification
- WP4-1: Native search graceful degradation
- WP4-2: DegradedReasonMapper duplicate key cleanup
- WP4-5: sessionId in top-level response

See full implementation guide: `.archive/ADR-091-agent-tool-adoption-failure-analysis-and-remediation.md`
