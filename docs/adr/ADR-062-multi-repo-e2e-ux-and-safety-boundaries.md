# ADR-062: Multi-Repo E2E UX & Safety Boundaries

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-047-multi-repo-multi-language.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`

## Summary

In multi-repo workspaces, enforce two invariants across both the tool surface and runtime:
1) results include repo boundary metadata, and
2) edits are cross-repo **default deny**.

## Decision (Contract)

### Repo scope

Search/explore/edit operations use `repoScope` to control which repos are in scope (compat also accepts `repoId`/`repoIds`).

```ts
type RepoScope =
  | { mode: "all" }
  | { mode: "default" }
  | { mode: "repos"; repoIds: string[] };
```

- Defaults: `project_search`/`document_search`/`explore` use `all`, while `change`/`write` use `default`.

### Search results include repo boundary

`project_search` results include:

- `path`: workspace-relative (no absolute paths)
- `repoId`: `"unscoped"` if repo matching fails
- `repoRelativePath`: path relative to the repo root

`document_search` results also include the same repo metadata (`repoId`, `repoRelativePath`).

### Default deny for cross-repo edits

`change`/`write` block cross-repo edits by default.

- Allow only if **all** of the following are true:
  - tool args: `allowCrossRepoEdits: true`
  - per-repo config: `allowCrossRepoEdits: true`
  - repo type is not `reference` (reference repos are always blocked)

### Typed reasons

Repo-boundary violations are surfaced via typed reasons in `degradedReasons`/`blockedReason`:

- `cross_repo_scope_mismatch`
- `cross_repo_edit_blocked`

## Implementation Notes

- RepoScope/metadata normalization: `src/utils/RepoScope.ts`
- Repo edit guard: `src/orchestration/pillars/shared/RepoGuard.ts`
- `project_search` repo metadata + repoScope filtering: `src/handlers/SearchHandlers.ts`
- `document_search` repoScope filter + repo metadata: `src/handlers/DocumentHandlers.ts`, `src/documents/search/SearchTypes.ts`
- Repo metadata in `explore`/`navigate` results: `src/orchestration/pillars/explore/ExplorePillar.ts`, `src/orchestration/pillars/NavigatePillar.ts`
- Default deny enforcement for `change`/`write`: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`
- Safe-default config bootstrap: `src/config/ConfigBootstrapper.ts` (`allowCrossRepoEdits` defaults to false)
- ToolSpec updates: `src/server/tools/ToolSpecRegistry.ts`

## Testing

- Search repo boundary/filtering: `src/tests/handlers/SearchHandlers.test.ts`
- Multi-repo E2E (search metadata + blocking): `src/tests/integration/MultiRepoToolSurface.e2e.test.ts`
