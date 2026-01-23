# Tool Reference Guide (Public Tool Surface)

Kairo exposes **two public tool surfaces** (ADR-084):

- **Compact (recommended; default in `KAIRO_MODE=mcp`)**: `task`, `manage`
- **Pillars (advanced; opt-in)**: `explore`, `understand`, `change`, `write`, `manage` (and `task` remains available)

Switch surfaces with `KAIRO_PUBLIC_SURFACE=compact|pillars`.

> Tool name note: Some MCP hosts display tools with a server prefix (e.g. `kairo_task`). The canonical tool names are `task`, `manage`, `explore`, `understand`, `change`, `write`.

---

## Compact Surface (Recommended)

### `task`

High-level router for promptless workflows (ask/analyze/plan/apply).

**Parameters**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `request` | `string` | ✓ | Natural-language request. |
| `mode` | `"auto" \| "ask" \| "analyze" \| "plan_change" \| "apply_change" \| "write" \| "verify"` |  | Default `auto`. `auto` never routes to apply. |
| `budget` | `"lean" \| "balanced" \| "deep"` |  | Default `lean`. Controls preset budgets/timeboxes. |
| `sessionId` | `string` |  | Flow session id (`"new"` to start). |
| `paths` | `string[]` |  | Hint paths for reading/searching. |
| `targetFiles` | `string[]` |  | Hint blast-radius for change planning/apply. |
| `targetPath` | `string` |  | Alias for a single target path (compat; mapped to `targetFiles[0]`). |
| `edits` | `object[]` |  | Optional pass-through edits. `plan_change` returns **prep** when omitted; returns a real DraftPack when provided. |
| `draftId` | `string` |  | Required for `apply_change` when applying a prior draft. |
| `applyToken` | `string` |  | Required for apply in `KAIRO_MODE=mcp` (minted during plan). |
| `refinement` | `string` |  | Extra guidance when refining a prior draft. |
| `safety` | `"plan" \| "apply"` |  | Hint only (used when `mode="auto"`). |
| `output.format` | `"summary" \| "standard"` |  | Default is policy-driven (typically `summary` in MCP mode). |
| `output.maxTokens` | `number` |  | Response envelope token cap for this call. |
| `output.maxChars` | `number` |  | Response envelope character cap for this call. |
| `trace` | `boolean` |  | Include `decisionTrace`/`effectiveOptions` when available. |

**Notes**

- `mode="plan_change"` behaves in two stages:
  - Without `edits`: returns target hints + `fileVersions` + `editsTemplate` (prep-only).
  - With `edits`: runs a real plan and returns `draftId` + (in MCP mode) `applyToken`.
- `mode="apply_change"` requires `draftId` and (in MCP mode) a valid `applyToken`.
- `mode="write"` / `mode="verify"` are supported on the compact surface (ADR-086).
- `mode="write"`: provide `targetPath` (or `targetFiles[0]`) and include content in a fenced code block inside `request` (e.g. ```ts ... ```). If no code block is present, plan mode will fall back to smart generation.
- `mode="verify"`: compares the current file content against the draft pack (when `draftId` is provided). `Base version` is a drift signal against the pre-apply snapshot and is only evaluated when draft content does not match.
- After successful apply flows, `task` may embed a cheap `verification` result in the same response (`apply_change`, or `write` with `safety="apply"`).
- Full schema on-demand: `manage({ command: "schema", tool: "task", detail: "full" })` (returns an artifact id).
- `output.maxTokens/maxChars` are hard caps; `task` will downshift LOD and inline evidence to fit.

**Response (task highlights)**

- `summary` — title/bullets/next (always present).
- `evidence` — bounded evidence list (ranked files and/or short excerpts based on LOD).
- `artifacts` — includes `evidence` packs (`kind: "evidence"`) for deeper follow-up via `manage`.
- `changePrep.targetStringCandidates` — bounded exact anchors for `plan_change` when available.
- `verification` — present for `mode="verify"` and may also appear on successful apply flows.
- `decisionTrace` — orchestration and LOD decisions when `trace: true`.
- `stats.responseBudget` — present when envelope enforcement applied.

**Usage**

- `task({ request: "Summarize the entrypoint." })`
- `task({ request: "Explain the architecture.", mode: "analyze", budget: "balanced" })`
- `task({ request: "Plan: tighten JWT validation.", mode: "plan_change", targetFiles: ["src/auth/jwt.ts"] })` (prep)
- `task({ request: "Plan: tighten JWT validation.", mode: "plan_change", edits: [{ filePath: "src/auth/jwt.ts", targetString: "OLD", replacementString: "NEW" }] })` (draft)
- `task({ request: "Apply the plan.", mode: "apply_change", draftId, applyToken })`
- `manage({ command: "artifact", target: "<evidenceId>", detail: "full" })` (deep evidence)

---

## Five Pillars (Advanced; `KAIRO_PUBLIC_SURFACE=pillars`)

The following reflects the **current inputs** as exposed by `src/server/tools/ToolSpecRegistry.ts`.

> Note: When `trace: true` is provided, tools return `effectiveOptions` and `decisionTrace` using the v1 schema:
> - `effectiveOptions.version = 1` (and `pillar`)
> - `decisionTrace.version = 1` (and `pillar`, `optionResolution`, `skips`, `events`)

### `explore`

Unified search + read interface for docs and code.

**Parameters**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `query` | `string` |  | Search query for docs/code. |
| `paths` | `string[]` |  | Explicit files/dirs to read. |
| `profile` | `"lean" \| "fast" \| "balanced" \| "deep"` |  | Preset for depth/limits/include defaults. |
| `sources` | `"code" \| "docs" \| "both"` |  | Prefer code vs docs search (default: both). |
| `view` | `"auto" \| "preview" \| "section" \| "full"` |  | Defaults to token-safe previews. |
| `section.sectionId` | `string` |  | Use when targeting a specific doc section. |
| `section.headingPath` | `string[]` |  | Alternative to sectionId. |
| `section.includeSubsections` | `boolean` |  | Include subsection content when viewing a section. |
| `include.docs` | `boolean` |  | Include document results. |
| `include.code` | `boolean` |  | Include code results. |
| `include.comments` | `boolean` |  | Include code-comment corpus (doc search). |
| `include.logs` | `boolean` |  | Include `.log` documents. |
| `include.clusters` | `boolean` |  | Include GraphRAG cluster summaries (when enabled). |
| `clusterOptions.maxClusters` | `number` |  | Max clusters returned (defaults depend on profile). |
| `clusterOptions.expansionDepth` | `number` |  | Depth for expensive graph expansions (best-effort). |
| `clusterOptions.includePreview` | `boolean` |  | Include preview/signature fields in clusters (best-effort). |
| `allowCrossRepoEdits` | `boolean` |  | Allows cross-repo cluster expansion when repo config also allows it. |
| `sessionId` | `string` |  | Flow session id (`"new"` to start). |
| `research.sketch` | `boolean` |  | Include ResearchPack sketch. |
| `research.topN` | `number` |  | Limit top modules for the sketch. |
| `research.format` | `"ascii" \| "mermaid" \| "both"` |  | Sketch output format. |
| `packId` | `string` |  | Evidence pack reuse. |
| `cursor.items` | `string` |  | Page through results (items). |
| `cursor.content` | `string` |  | Expand content from a pack without re-search. |
| `limits.maxResults` | `number` |  | Per-group result cap. |
| `limits.maxChars` | `number` |  | Total content budget (also used as a response envelope char cap when set). |
| `limits.maxTokens` | `number` |  | Response envelope token budget cap (final tool output JSON). |
| `limits.maxItemChars` | `number` |  | Per-item cap. |
| `limits.maxBytes` | `number` |  | Hard cap for full reads. |
| `limits.maxFiles` | `number` |  | Cap the number of files scanned/considered. |
| `limits.timeoutMs` | `number` |  | Per-call timeout budget (best-effort). |
| `fullPaths` | `string[]` |  | When view=full, only these get full content. |
| `allowSensitive` | `boolean` |  | Opt-in for sensitive files. |
| `allowBinary` | `boolean` |  | Opt-in for binary files. |
| `allowGlobs` | `boolean` |  | Opt-in for glob paths. |
| `trace` | `boolean` |  | Return v1 `effectiveOptions` + v1 `decisionTrace`. |

**Usage**

- `explore({ query: "AuthService" })`
- `explore({ paths: ["src/auth/AuthService.ts"], view: "full" })`
- `explore({ query: "refund", packId, cursor: { items } })`
- `explore({ research: { sketch: true }, sessionId: "new" })`
- `explore({ query: "ADR-051", profile: "deep", sources: "docs", trace: true })`

---

### `understand`

Deep analysis of structure and relationships (opt-in includes).

**Parameters**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `goal` | `string` | ✓ | What you want to understand (symbol/file/free-text). |
| `scope` | `"symbol" \| "file" \| "module" \| "project"` |  | Narrow the search mode. |
| `depth` | `"shallow" \| "standard" \| "deep"` |  | Controls analysis depth. |
| `profile` | `"lean" \| "fast" \| "balanced" \| "deep"` |  | Preset for analysis defaults. |
| `sources` | `"code" \| "docs" \| "both"` |  | Prefer code vs docs (note: doc search support is rolling out). |
| `include.callGraph` | `boolean` |  | Include call graph (default is conservative; enable explicitly). |
| `include.dependencies` | `boolean` |  | Include dependency edges. |
| `include.hotSpots` | `boolean` |  | Include hotspot signals. |
| `include.pageRank` | `boolean` |  | Include architectural importance signals. |
| `include.clusters` | `boolean` |  | Include GraphRAG cluster summaries (when enabled). |
| `sessionId` | `string` |  | Flow session id (`"new"` to start). |
| `vibe.extract` | `boolean` |  | Produce a StylePack. |
| `vibe.scope` | `string` |  | Glob scope for style sampling. |
| `vibe.includeNorms` | `boolean` |  | Include norms from ADR/README. |
| `analysis.clusters` | `boolean` |  | Produce an AnalysisPack. |
| `analysis.maxClusters` | `number` |  | Max cluster count. |
| `analysis.maxFilesPerCluster` | `number` |  | Max files per cluster. |
| `clusterOptions.maxClusters` | `number` |  | Max clusters returned (GraphRAG). |
| `clusterOptions.expansionDepth` | `number` |  | Depth for expensive graph expansions (best-effort). |
| `clusterOptions.includePreview` | `boolean` |  | Include preview/signature fields in clusters (best-effort). |
| `allowCrossRepoEdits` | `boolean` |  | Allows cross-repo cluster expansion when repo config also allows it. |
| `limits.timeoutMs` | `number` |  | Per-call timeout budget (best-effort). |
| `limits.maxTokens` | `number` |  | Response envelope token budget cap (final tool output JSON). |
| `limits.maxChars` | `number` |  | Hard cap on response JSON size (chars). |
| `trace` | `boolean` |  | Return v1 `effectiveOptions` + v1 `decisionTrace`. |

**Notes**

- `profile` may be automatically downshifted for cost stability unless explicitly provided; set `trace: true` to inspect the final decision (`decisionTrace`).
- When `include.callGraph=true`, `understand` returns a summary `callGraph` plus `callGraphArtifactId`/`callGraphSummary` so the full graph can be fetched via `manage({ command: "artifact", target: <id> })`.

---

### `change`

Plan/apply safe edits with impact analysis.

**Parameters**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `intent` | `string` | ✓ | Describe the change in natural language. |
| `target` | `string` |  | Optional hint (file/symbol). |
| `targetFiles` | `string[]` |  | Constrain the blast radius. |
| `edits` | `object[]` |  | Structured edits (advanced). |
| `fileVersions` | `object` |  | Advanced stale-guard: `{ [relPath]: { expectedVersion?, expectedHash? } }` (typically from `DraftPack.fileVersions` or a prior read). |
| `profile` | `"lean" \| "fast" \| "balanced" \| "deep"` |  | Preset for review/limits defaults. |
| `safety` | `"plan" \| "apply"` |  | Maps to dry-run behavior (plan=true by default). |
| `options.dryRun` | `boolean` |  | Default behavior is dry-run planning. |
| `draftId` | `string` |  | Continue a refinement loop from a prior DraftPack. |
| `applyToken` | `string` |  | Required for `safety:"apply"` in `KAIRO_MODE=mcp` (minted during plan). |
| `refinement` | `string` |  | Extra guidance when refining a prior draft. |
| `draftOptions.skeletonOnly` | `boolean` |  | Skeleton-only DraftPack output. |
| `draftOptions.includeImpact` | `boolean` |  | Include impact signals in DraftPack. |
| `reviewOptions.preApply` | `boolean` |  | Run pre-apply review. |
| `reviewOptions.postApply` | `boolean` |  | Run post-apply review. |
| `reviewOptions.strictness` | `"strict" \| "balanced" \| "permissive"` |  | Review policy. |
| `reviewOptions.blockOn` | `("syntax" \| "semantic" \| "guardrails" \| "vibe")[]` |  | Blocking criteria. |
| `sessionId` | `string` |  | Flow session id (`"new"` to start). |
| `stylePack` | `string \| object` |  | Override StylePack (artifact id or inline pack). |
| `options.includeImpact` | `boolean` |  | Include `impactReport` (may be suggested by guidance for public API / cross-language risk). |
| `options.includeSymbolImpact` | `boolean` |  | Include symbol-level impact signals (when available). |
| `options.autoRollback` | `boolean` |  | Reserved (implementation-dependent). |
| `options.batchMode` | `boolean` |  | Reserved (implementation-dependent). |
| `options.suggestDocs` | `boolean` |  | Enable doc update suggestions on successful apply. |
| `options.batchImpactLimit` | `number` |  | Max files to include in batch impact preview. |
| `options.formatter` | `"auto" \| "off" \| "prettier"` |  | Opt-in formatter run after apply. |
| `strategySearch.mode` | `"off" \| "auto" \| "force"` |  | Default `auto`. `off` disables; `force` always runs at `stage`. |
| `strategySearch.stage` | `"r0" \| "r1" \| "r2" \| "r3"` |  | Default `r1` when mode is not `off`. |
| `strategySearch.candidates` | `object[]` |  | Required when mode is not `off`. |
| `strategySearch.maxCandidates` | `number` |  | Default `2` (hard cap `3`). |
| `strategySearch.timeboxMs` | `number` |  | Default `700`. |
| `strategySearch.maxSimulationMs` | `number` |  | Default `350`. |
| `strategySearch.maxImpactMs` | `number` |  | Default `250`. |
| `strategySearch.maxTouchedFiles` | `number` |  | Default `20`. |
| `strategySearch.maxTokensEstimated` | `number` |  | Default `2400`. |
| `strategySearch.scoring.weights.*` | `number` |  | Weights for files/diff/tokens/risk/breaking/contract/guardsHigh. |
| `strategySearch.mcts.*` | `object` |  | R3 only: `{ maxDepth, maxRollouts, exploration, seed? }`. |
| `trace` | `boolean` |  | Return v1 `effectiveOptions` + v1 `decisionTrace`. |

**Notes**

- `profile` may be automatically downshifted for cost stability unless explicitly provided; set `trace: true` to inspect the final decision (`decisionTrace`).
- In `KAIRO_MODE=mcp`, apply is server-gated by default: plan returns `applyToken`, and apply requires `draftId + applyToken`.
- StrategySearch is opt-in: if `strategySearch` is omitted, no candidate evaluation runs (R0 baseline).
- If `strategySearch.mode` is `auto` or `force` but no candidates are supplied, the engine falls back to R0 and returns a degraded reason.

**StrategySearch candidates**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `strategySearch.candidates[].id` | `string` | ✓ | Unique candidate id. |
| `strategySearch.candidates[].label` | `string` |  | Label such as `baseline` or `alt`. |
| `strategySearch.candidates[].intent` | `string` |  | Overrides top-level `intent` for this candidate. |
| `strategySearch.candidates[].target` | `string` |  | Optional `target` hint. |
| `strategySearch.candidates[].targetFiles` | `string[]` |  | Constrain blast radius for this candidate. |
| `strategySearch.candidates[].edits` | `object[]` | ✓ | Structured edits (MVP requires explicit edits). |
| `strategySearch.candidates[].children` | `object[]` |  | Optional child candidates for MCTS expansion (R3). |
| `strategySearch.candidates[].options.diffMode` | `"myers" \| "semantic"` |  | Diff mode for dry-run evaluation. |
| `strategySearch.candidates[].options.includeImpact` | `boolean` |  | Candidate-level impact toggle. |
| `strategySearch.candidates[].notes` | `string` |  | Freeform notes for trace/debugging. |

**R3 MCTS example**

```json
{
  "strategySearch": {
    "mode": "force",
    "stage": "r3",
    "maxCandidates": 1,
    "mcts": { "maxDepth": 2, "maxRollouts": 5, "exploration": 1.4, "seed": 7 },
    "candidates": [
      {
        "id": "root",
        "edits": [{ "targetString": "ROOT", "replacementString": "ROOT1" }],
        "children": [
          { "id": "leaf_a", "edits": [{ "targetString": "A", "replacementString": "A1" }] },
          { "id": "leaf_b", "edits": [{ "targetString": "B", "replacementString": "B1" }] }
        ]
      }
    ]
  }
}
```

**R3 Tree guidance**

- Each node must be a complete, executable candidate (`edits` required on every node).
- Root nodes represent distinct strategies; children are refinements (smaller diff, fewer files, added guards).
- Default `mcts` is `{ maxDepth: 2, maxRollouts: 5, exploration: 1.4 }`.
- Keep depth ≤2 and branching ≤3 for predictable timeboxes; increase `maxRollouts` if deeper.
- Use `targetFiles` to bound blast radius; use `notes` to capture rationale.

**StrategySearch output (change)**

When `strategySearch` runs, the response includes:

- `strategySearch.mode`, `strategySearch.stage`
- `strategySearch.selectedCandidateId`
- `strategySearch.selectedRewardBreakdown` (reward breakdown for the selected candidate)
- `strategySearch.degradedReasons[]`
- `strategySearch.search` (R3 only: `{ algorithm, rollouts, maxDepth, exploration, seed?, evaluatedCount }`)
- `strategySearch.candidates[]` with:
  - `id`, `label`, `dryRunOk`, `reward`, `riskLevel?`
  - `touchedFiles`, `diffSize`, `estimatedTokens`
  - `breakingChanges`
  - `contractBreaking`, `contractConsumers`, `guardsHigh`, `guardsDiagnostics`
  - `rewardBreakdown` (`base`, `penalties.*`, `signals.*`)

See `docs/adr/ADR-082-simulate-reason-execute-mcts.md` for rationale, defaults, and tuning guidance.

**Workflow output**

When using sessions (Writer's Flow), `change` also returns:

- `workflowMeta` — confidence + workflowStatus (hasResearch/hasAnalysis/hasStylePack/dryRunUsed)
- `workflowWarnings` — actionable guidance for missing flow artifacts (optional; only present when needed)

**Output (v2 / resolver path)**

When `KAIRO_EDITOR_V2=true` and `KAIRO_EDITOR_V2_MODE` is not `off`, the resolver path is used for **batch-shaped** edits:

- `KAIRO_EDITOR_V2_MODE=dryrun`: returns `{ success: true, dryRun: true, resolvedEdits: [...] }`
- `KAIRO_EDITOR_V2_MODE=apply`: returns `{ success, dryRun, message?, changedFiles: [...] }`

**ENV Configuration**

- `KAIRO_EDITOR_V2=true` — Enable v2 "Resolve → Apply" separation (default: `false`)
- `KAIRO_EDITOR_V2_MODE=off|dryrun|apply` — Rollout stage (default: `off`)
  - `dryrun`: Resolve-only diagnostics without applying
  - `apply`: Full v2 execution path
- `KAIRO_EDITOR_RESOLVE_TIMEOUT_MS=1500` — Max time for edit resolution
- `KAIRO_CHANGE_MIN_LEVENSHTEIN_TARGET_LEN=20` — Block fuzzy matching on short targets
- `KAIRO_CHANGE_MAX_LEVENSHTEIN_FILE_BYTES=100000` — Block fuzzy matching on large files

---

### `write`

Create or scaffold files.

**Parameters**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `intent` | `string` | ✓ | What to create. |
| `targetPath` | `string` |  | Where to create it. |
| `template` | `string` |  | Template name/path (if supported). |
| `content` | `string` |  | Explicit content overrides generation. |
| `fileVersions` | `object` |  | Advanced stale-guard: `{ [relPath]: { expectedVersion?, expectedHash? } }` (typically from `DraftPack.fileVersions` or a prior read). |
| `profile` | `"lean" \| "fast" \| "balanced" \| "deep"` |  | Preset for review/limits defaults. |
| `safety` | `"plan" \| "apply"` |  | Maps to dry-run behavior (plan=true by default). |
| `dryRun` | `boolean` |  | Generate DraftPack only. |
| `draftId` | `string` |  | Continue a refinement loop from a prior DraftPack. |
| `applyToken` | `string` |  | Required for `safety:"apply"` in `KAIRO_MODE=mcp` (minted during plan). |
| `refinement` | `string` |  | Extra guidance when refining a prior draft. |
| `draftOptions.skeletonOnly` | `boolean` |  | Skeleton-only DraftPack output. |
| `draftOptions.includeImpact` | `boolean` |  | Include impact signals in DraftPack. |
| `reviewOptions.preApply` | `boolean` |  | Run pre-apply review. |
| `reviewOptions.postApply` | `boolean` |  | Run post-apply review. |
| `reviewOptions.strictness` | `"strict" \| "balanced" \| "permissive"` |  | Review policy. |
| `reviewOptions.blockOn` | `("syntax" \| "semantic" \| "guardrails" \| "vibe")[]` |  | Blocking criteria. |
| `sessionId` | `string` |  | Flow session id (`"new"` to start). |
| `stylePack` | `string \| object` |  | Override StylePack (artifact id or inline pack). |
| `options.safeWrite` | `boolean` |  | Use transactional write path (undo/rollback support when available). |
| `options.quickGenerate` | `boolean` |  | Generate content from intent when `content` is not provided. |
| `options.smartWrite` | `boolean` |  | Pattern-aware generation using similar files (when possible). |
| `options.styleReference` | `string[]` |  | Optional explicit reference files for pattern extraction. |
| `options.formatter` | `"auto" \| "off" \| "prettier"` |  | Opt-in formatter run after apply. |
| `trace` | `boolean` |  | Return v1 `effectiveOptions` + v1 `decisionTrace`. |

**Notes**

- `change(plan)` failure may include `schemaCoaching` with `requiredFields`, `editsTemplate`, and `helpUrl` to guide a retry.

**Workflow output**

When using sessions (Writer's Flow), `write` also returns:

- `workflowMeta` — confidence + workflowStatus (hasResearch/hasAnalysis/hasStylePack/dryRunUsed)
- `workflowWarnings` — actionable guidance for missing flow artifacts (optional; only present when needed)

**Output (safeWrite mode)**

When `options.safeWrite=true`:

| Field | Type | Notes |
|---|---|---|
| `writeMode` | `"fast" \| "safe"` | Indicates execution path. |
| `rollbackAvailable` | `boolean` | True when operation record created for undo. |
| `transactionId` | `string` | Transaction ID if grouped with other operations. |

---

### `manage`

Project/session state utilities.

- `manage({ command: "status" })` returns a `rollout` summary (preset/userIdHash/flag modes + adaptive flow gate).
- `manage({ command: "status" })` returns `symbolIndex` (semantic symbol index status: enabled/build time/degraded).
- `manage({ command: "status" })` returns `nativeSearch` (native search core status, including availability/docCount and write-lock signals).
- `manage({ command: "status" })` returns `drift` (workspace drift summary).
- `manage({ command: "status" })` returns `styleDrift` (StylePack provenance/confidence summary).
- `manage({ command: "doctor" })` also returns a `rollout` block with the same operational diagnostics.
- `manage({ command: "schema", tool: "task", detail: "summary" })` returns a summary of the tool input schema. With `detail:"full"`, the schema is stored as an artifact and an `artifactId` is returned (fetch via `manage({ command: "artifact" | "export", ... })`).
- `manage({ command: "history" })` returns recent committed transaction checkpoint summaries (`checkpoints`).
- `manage({ command: "reindex", paths: [...] })` attempts a scoped reindex of specific paths (only when supported by the runtime).
- `manage({ command: "export", targetType: "transaction", target: "<txId>" })` returns a patch export.
- `manage({ command: "import", target: "<path>" })` is restricted to `.kairo` by default. Importing from outside requires `allowExternal: true` or `KAIRO_MANAGE_IMPORT_ALLOW_EXTERNAL=true`.
- `manage({ command: "artifact", detail: "summary" | "full" })` returns summary/full views for graph and evidence artifacts.
- For raw graph payloads, use `manage({ command: "export", targetType: "artifact", target: "<artifactId>" })`.

**Parameters**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `command` | `"status" \| "undo" \| "redo" \| "reindex" \| "rebuild" \| "history" \| "test" \| "init" \| "doctor" \| "schema" \| "sessions" \| "session" \| "session_complete" \| "session_update" \| "artifacts" \| "artifact" \| "discard" \| "prune" \| "export" \| "import"` | ✓ | `rebuild` maps to `reindex`. |
| `scope` | `"file" \| "transaction" \| "project" \| "config" \| "languages" \| "wasm" \| "host" \| "contracts" \| "parity" \| "capabilities"` |  | Used by `test`/`doctor`. |
| `tool` | `string` |  | Tool name (used by `schema`). |
| `target` | `string` |  | Mainly used by `test`. |
| `paths` | `string[]` |  | Used by `reindex` for incremental/path-scoped refresh (when supported). |
| `targetType` | `"artifact" \| "transaction" \| "patchRef"` |  | `export` target type. |
| `allowExternal` | `boolean` |  | Allow `import` from outside `.kairo`. |
| `format` | `"unified_diff" \| "structured_edits" \| "both"` |  | `export` output format. |
| `limit` | `number` |  | Max items for list commands (sessions); graph artifact view caps node count. |
| `checkpointLimit` | `number` |  | Max checkpoints returned by `history` (default 10). |
| `detail` | `"summary" \| "full"` |  | Detail level for `status`/`doctor`/`schema`. |
| `limits.maxTokens` | `number` |  | Response envelope token budget for `artifact` retrieval. |
| `limits.maxChars` | `number` |  | Response envelope char budget for `artifact` retrieval. |
| `trace` | `boolean` |  | Return v1 `effectiveOptions` + v1 `decisionTrace`. |
| `sessionId` | `string` |  | Session id for `session` / `session_complete`. |
| `outcome` | `object` |  | Used by `session_complete` (e.g. `{ summary, status, nextSteps }`). |
| `policy` | `object` |  | SessionPolicy update for `session_update`. |
| `policyMode` | `"merge" \| "replace"` |  | Merge or replace session policy. |
| `artifactOptions.type` | `string` |  | Filter artifacts by type. |
| `artifactOptions.sessionId` | `string` |  | Filter artifacts by session. |
| `artifactOptions.limit` | `number` |  | Max artifacts to return. |
| `artifactOptions.includeExpired` | `boolean` |  | Include expired artifacts. |
| `mode` | `"plan" \| "apply"` |  | Used by `init`/`doctor`/`prune` to preview or apply. |
| `targets` | `("kairo" \| "vscode")[]` |  | Used by `init` to decide which config to write. |
| `root` | `string` |  | Config root override for `init`/`doctor`. |
| `multiRepo` | `"auto" \| "single" \| "detect"` |  | Multi-repo config behavior for `init`. |
| `presets` | `"minimal" \| "recommended"` |  | Config preset for `init`. |
| `languageScan.maxFiles` | `number` |  | Max files scanned by `init`. |
| `languageScan.sampleBytesPerFile` | `number` |  | Sample size per file for `init`. |
| `languageScan.includeDocs` | `boolean` |  | Include docs in scan for `init`. |
| `applyOptions.backup` | `boolean` |  | Keep backup when writing config. |
| `applyOptions.legacyMcpConfig` | `boolean` |  | Update legacy root `.mcp-config.json` after migration. |
| `pruneOptions` | `object` |  | Storage prune options (see below). |

---

**Prune options (`manage` command = `prune`)**

| Field | Type | Notes |
|---|---|---|
| `pruneOptions.targets` | `("evidence_packs" \| "chunk_summaries" \| "flow_artifacts")[]` | Defaults to all. |
| `pruneOptions.includeExpired` | `boolean` | Include expired entries (default true). |
| `pruneOptions.includeStale` | `boolean` | Include stale entries (default true). |
| `pruneOptions.enforceCaps` | `boolean` | Enforce max count/bytes caps (default true). |
| `pruneOptions.compact` | `boolean` | Rewrite store after prune. |
| `pruneOptions.limits.maxPacks` | `number` | Max evidence packs. |
| `pruneOptions.limits.maxPackBytes` | `number` | Max evidence pack bytes. |
| `pruneOptions.limits.maxSummaryChunks` | `number` | Max summary chunks. |
| `pruneOptions.limits.maxSummaryBytes` | `number` | Max summary bytes. |
| `pruneOptions.flowArtifacts.removeOrphans` | `boolean` | Remove orphaned artifact files. |

---

## Quick Tool Selector

```
What do you need?
├─ Promptless/default UX?  → task
├─ Find or read content?   → task (ask/analyze) or explore
├─ Explain structure?      → task (analyze) or understand
├─ Change code safely?     → task (plan_change/apply_change) or change
├─ Create files?           → write (pillars surface)
└─ Undo/redo/reindex/etc?  → manage
```

---

## Composition Patterns

### Explore → Understand
- `explore({ query: "payments" })`
- `understand({ goal: "Explain the main payment flow" })`

### Plan → Apply (with constraints)
- Plan first, then apply:
  - `change({ ..., safety: "plan" })` → returns `draftId` (+ `applyToken` in MCP mode)
  - `change({ ..., safety: "apply", draftId, applyToken })`

### Multi-repo safety (default deny)
- `project_search`/`document_search` accept `repoScope` to narrow results.
- `explore` accepts `repoScope` to scope discovery results (passed through to underlying search tools).
- `change`/`write` block cross-repo edits by default; require `allowCrossRepoEdits: true` plus repo config `allowCrossRepoEdits: true`.

### Recover
- If edits go wrong: `manage({ command: "undo" })`
- If results look stale: `manage({ command: "reindex" })`

### Bootstrap config
- `manage({ command: "init", mode: "plan" })` to generate a safe config plan
- `manage({ command: "init", mode: "apply" })` to write config files
- `manage({ command: "doctor" })` to diagnose missing/misplaced settings
- `manage({ command: "doctor", scope: "parity" })` to check query packs + WASM grammar availability
- `manage({ command: "doctor", scope: "capabilities" })` to inspect provider/tier diagnostics (native/wasm/js) and tokenizer hints
- `manage({ command: "doctor", scope: "contracts" })` to check `.kairo/contracts` health

---

## Internal Tools (Opt-in)

`kairo` is intended to be called via the public surface (`task` + `manage` on compact, or the Five Pillars on pillars). If you find other tool names exposed by a host, treat them as unstable.
