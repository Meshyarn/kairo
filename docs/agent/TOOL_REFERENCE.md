# Tool Reference Guide (Five Pillars)

The agent-facing interface is the **Five Pillars**:

- `explore` — unified discovery (search + preview/section + optional full reads)
- `understand` — synthesize structure/relationships
- `change` — plan/apply safe edits (dry-run first)
- `write` — create/scaffold files
- `manage` — status/undo/redo/reindex/history

`kairo` is designed to be used via these pillars; any other internal/legacy tool names (if present) are not considered stable API.

---

## Five Pillars (Recommended)

The following reflects the **current inputs** as exposed by `src/index.ts`.

### `explore`

Unified search + read interface for docs and code.

**Parameters**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `query` | `string` |  | Search query for docs/code. |
| `paths` | `string[]` |  | Explicit files/dirs to read. |
| `profile` | `"fast" \| "balanced" \| "deep"` |  | Preset for depth/limits/include defaults. |
| `sources` | `"code" \| "docs" \| "both"` |  | Prefer code vs docs search (default: both). |
| `view` | `"auto" \| "preview" \| "section" \| "full"` |  | Defaults to token-safe previews. |
| `section.sectionId` | `string` |  | Use when targeting a specific doc section. |
| `section.headingPath` | `string[]` |  | Alternative to sectionId. |
| `section.includeSubsections` | `boolean` |  | Include subsection content when viewing a section. |
| `include.docs` | `boolean` |  | Include document results. |
| `include.code` | `boolean` |  | Include code results. |
| `include.comments` | `boolean` |  | Include code-comment corpus (doc search). |
| `include.logs` | `boolean` |  | Include `.log` documents. |
| `sessionId` | `string` |  | Flow session id (`"new"` to start). |
| `research.sketch` | `boolean` |  | Include ResearchPack sketch. |
| `research.topN` | `number` |  | Limit top modules for the sketch. |
| `research.format` | `"ascii" \| "mermaid" \| "both"` |  | Sketch output format. |
| `packId` | `string` |  | Evidence pack reuse. |
| `cursor.items` | `string` |  | Page through results (items). |
| `cursor.content` | `string` |  | Expand content from a pack without re-search. |
| `limits.maxResults` | `number` |  | Per-group result cap. |
| `limits.maxChars` | `number` |  | Total content budget. |
| `limits.maxItemChars` | `number` |  | Per-item cap. |
| `limits.maxBytes` | `number` |  | Hard cap for full reads. |
| `limits.maxFiles` | `number` |  | Cap the number of files scanned/considered. |
| `limits.timeoutMs` | `number` |  | Per-call timeout budget (best-effort). |
| `fullPaths` | `string[]` |  | When view=full, only these get full content. |
| `allowSensitive` | `boolean` |  | Opt-in for sensitive files. |
| `allowBinary` | `boolean` |  | Opt-in for binary files. |
| `allowGlobs` | `boolean` |  | Opt-in for glob paths. |
| `trace` | `boolean` |  | Return `effectiveOptions` + `decisionTrace`. |

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
| `profile` | `"fast" \| "balanced" \| "deep"` |  | Preset for analysis defaults. |
| `sources` | `"code" \| "docs" \| "both"` |  | Prefer code vs docs (note: doc search support is rolling out). |
| `include.callGraph` | `boolean` |  | Include call graph (default is conservative; enable explicitly). |
| `include.dependencies` | `boolean` |  | Include dependency edges. |
| `include.hotSpots` | `boolean` |  | Include hotspot signals. |
| `include.pageRank` | `boolean` |  | Include architectural importance signals. |
| `sessionId` | `string` |  | Flow session id (`"new"` to start). |
| `vibe.extract` | `boolean` |  | Produce a StylePack. |
| `vibe.scope` | `string` |  | Glob scope for style sampling. |
| `vibe.includeNorms` | `boolean` |  | Include norms from ADR/README. |
| `analysis.clusters` | `boolean` |  | Produce an AnalysisPack. |
| `analysis.maxClusters` | `number` |  | Max cluster count. |
| `analysis.maxFilesPerCluster` | `number` |  | Max files per cluster. |
| `limits.timeoutMs` | `number` |  | Per-call timeout budget (best-effort). |
| `trace` | `boolean` |  | Return `effectiveOptions` + `decisionTrace`. |

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
| `profile` | `"fast" \| "balanced" \| "deep"` |  | Preset for review/limits defaults. |
| `safety` | `"plan" \| "apply"` |  | Maps to dry-run behavior (plan=true by default). |
| `options.dryRun` | `boolean` |  | Default behavior is dry-run planning. |
| `draftId` | `string` |  | Continue a refinement loop from a prior DraftPack. |
| `refinement` | `string` |  | Extra guidance when refining a prior draft. |
| `draftOptions.skeletonOnly` | `boolean` |  | Skeleton-only DraftPack output. |
| `draftOptions.includeImpact` | `boolean` |  | Include impact signals in DraftPack. |
| `reviewOptions.preApply` | `boolean` |  | Run pre-apply review. |
| `reviewOptions.postApply` | `boolean` |  | Run post-apply review. |
| `reviewOptions.strictness` | `"strict" \| "balanced" \| "permissive"` |  | Review policy. |
| `reviewOptions.blockOn` | `("syntax" \| "semantic" \| "guardrails" \| "vibe")[]` |  | Blocking criteria. |
| `sessionId` | `string` |  | Flow session id (`"new"` to start). |
| `stylePack` | `string \| object` |  | Override StylePack (artifact id or inline pack). |
| `options.includeImpact` | `boolean` |  | Include impact report when enabled. |
| `options.includeSymbolImpact` | `boolean` |  | Include symbol-level impact signals (when available). |
| `options.autoRollback` | `boolean` |  | Reserved (implementation-dependent). |
| `options.batchMode` | `boolean` |  | Reserved (implementation-dependent). |
| `options.suggestDocs` | `boolean` |  | Enable doc update suggestions on successful apply. |
| `options.batchImpactLimit` | `number` |  | Max files to include in batch impact preview. |
| `trace` | `boolean` |  | Return `effectiveOptions` + `decisionTrace`. |

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
| `profile` | `"fast" \| "balanced" \| "deep"` |  | Preset for review/limits defaults. |
| `safety` | `"plan" \| "apply"` |  | Maps to dry-run behavior (plan=true by default). |
| `dryRun` | `boolean` |  | Generate DraftPack only. |
| `draftId` | `string` |  | Continue a refinement loop from a prior DraftPack. |
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
| `trace` | `boolean` |  | Return `effectiveOptions` + `decisionTrace`. |

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

**Parameters**

| Field | Type | Required | Notes |
|---|---|---:|---|
| `command` | `"status" \| "undo" \| "redo" \| "reindex" \| "rebuild" \| "history" \| "test" \| "sessions" \| "session" \| "session_complete" \| "session_update" \| "artifacts" \| "artifact" \| "discard" \| "prune" \| "export" \| "import"` | ✓ | `rebuild` maps to `reindex`. |
| `scope` | `"file" \| "transaction" \| "project"` |  | Mainly used by `test`. |
| `target` | `string` |  | Mainly used by `test`. |
| `limit` | `number` |  | Max items for list commands (sessions). |
| `sessionId` | `string` |  | Session id for `session` / `session_complete`. |
| `outcome` | `object` |  | Used by `session_complete` (e.g. `{ summary, status, nextSteps }`). |
| `policy` | `object` |  | SessionPolicy update for `session_update`. |
| `policyMode` | `"merge" \| "replace"` |  | Merge or replace session policy. |
| `artifactOptions.type` | `string` |  | Filter artifacts by type. |
| `artifactOptions.sessionId` | `string` |  | Filter artifacts by session. |
| `artifactOptions.limit` | `number` |  | Max artifacts to return. |
| `artifactOptions.includeExpired` | `boolean` |  | Include expired artifacts. |

---

## Quick Tool Selector

```
What do you need?
├─ Find or read content?   → explore
├─ Explain structure?      → understand
├─ Change code safely?     → change
├─ Create files?           → write
└─ Undo/redo/reindex?      → manage
```

---

## Composition Patterns

### Explore → Understand
- `explore({ query: "payments" })`
- `understand({ goal: "Explain the main payment flow" })`

### Plan → Apply (with constraints)
- `change(options.dryRun=true)` with a clear intent + `targetFiles`
- Review output
- `change(options.dryRun=false)` to apply

### Recover
- If edits go wrong: `manage({ command: "undo" })`
- If results look stale: `manage({ command: "reindex" })`

### Bootstrap config
- `manage({ command: "init", mode: "plan" })` to generate a safe config plan
- `manage({ command: "init", mode: "apply" })` to write config files
- `manage({ command: "doctor" })` to diagnose missing/misplaced settings

---

## Internal Tools (Opt-in)

`kairo` is intended to be called via the Five Pillars. If you find other tool names exposed by a host, treat them as unstable and prefer the pillars.
