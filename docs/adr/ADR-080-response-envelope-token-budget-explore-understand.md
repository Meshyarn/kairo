# ADR-080 (Summary): Explore/Understand Response Envelope Token Budget

**Status:** Implemented (0.4.x baseline)  
**Date:** 2026-01-18  
**Related:** `docs/adr/ADR-056-token-aware-dynamic-context-compression.md`, `docs/adr/ADR-074-token-budget-allocator-v2-cross-pillar-summary-reuse.md`, `docs/adr/ADR-073-option-trace-standardization-decisiontrace-effectiveoptions.md`

## Why
`explore`/`understand` already applied token budgets internally (text truncate/distill), but the **final tool output JSON (response envelope)** did not have a consistent, end-to-end budget cap.  
In particular, `understand(include.callGraph=true)` could blow up as the call graph expands into large node/edge arrays, increasing context overflow/cost/UX risk.

## What shipped
- **Fixed meaning of `limits.maxTokens`:** interpret `limits.maxTokens` as the **token cap for the final response JSON**.
- **`limits.maxChars` support:** apply `limits.maxChars` as a **hard char cap for the final response JSON** (if both token/char are provided, satisfy both).
- **Two-pass budget enforcement:**
  - (A) Apply downshift/omit during generation via section planning (allocator v2)
  - (B) After generation, apply a second pass using the **response envelope** as the budget basis (ladder)
- **Call graph separation (progressive disclosure):**
  - The base `understand` response keeps a token-safe summarized `callGraph` shape
  - The full/detailed graph is separated into a **graph artifact** (`callGraphArtifactId`, `callGraphSummary`)
  - Fetch via `manage({ command: "artifact", target: callGraphArtifactId, detail: "summary" | "full" })`
- **Explainability:** enable tracing “why it shrank / what was removed” via `compression` + `degradedReasons` + `decisionTrace`.

## How to use
- Set response-envelope budgets:
  - `explore({ ..., limits: { maxTokens: 8000 } })`
  - `understand({ ..., limits: { maxTokens: 6000, maxChars: 60000 } })`
- Call graph expansion (summary + artifact):
  - `understand({ goal: "SomeSymbol", include: { callGraph: true } })`
  - Then `manage({ command: "artifact", target: callGraphArtifactId, detail: "summary" })`
- Note: `limits.maxTokens` applies to the **entire final JSON**, not just “some text”.
- Server defaults (env vars, when `limits.maxTokens` is not provided):
  - `KAIRO_DEFAULT_MAX_TOKENS`, `KAIRO_EXPLORE_MAX_TOKENS`, `KAIRO_UNDERSTAND_MAX_TOKENS`
  - Artifact fetch (`manage command=artifact`) uses `KAIRO_MANAGE_MAX_TOKENS`/`KAIRO_MANAGE_MAX_CHARS`
  - Token estimator: `KAIRO_TOKEN_ESTIMATOR=whitespace` (default) or `KAIRO_TOKEN_ESTIMATOR=chars`

## Output signals
- `degraded: true` with `budget_exceeded` in `reasons/degradedReasons` (or related budget-reduction reasons)
- `compression`:
  - `applied`, `mode`, `decisions` (when available)
- `stats.responseBudget`:
  - `applied`, `estimatedTokens`, `usedChars`, `maxTokens`, `maxChars`
- `decisionTrace`:
  - budget/omit/downshift events and whether they were ultimately applied

## Key code paths
- Response envelope budgeter: `src/orchestration/budget/ResponseEnvelopeBudgeter.ts`
- Explore post-pass enforcement: `src/orchestration/pillars/explore/ExplorePillar.ts`
- Understand graph artifact + enforcement: `src/orchestration/pillars/UnderstandPillar.ts`
- Graph artifacts types: `src/types/flow-artifacts.ts`
- Manage artifact view: `src/handlers/ManageHandlers.ts`

