# ADR-062: Multi-Repo E2E UX & Safety Boundaries

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-047-multi-repo-multi-language.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`

## Summary

멀티 레포 환경에서 “결과는 repo 경계를 포함”하고, “편집은 기본적으로 cross-repo를 막는다(default deny)”를 도구 표면과 런타임 모두에서 고정한다.

## Decision (Contract)

### Repo scope

검색/탐색/편집은 `repoScope`로 대상 레포를 제어한다(compat로 `repoId`/`repoIds`도 허용).

```ts
type RepoScope =
  | { mode: "all" }
  | { mode: "default" }
  | { mode: "repos"; repoIds: string[] };
```

- 기본값: `project_search`/`document_search`/`explore`는 `all`, `change`/`write`는 `default`

### Search results include repo boundary

`project_search` 결과는 다음 정보를 포함한다.

- `path`: workspace-relative (절대경로 금지)
- `repoId`: 매칭 실패 시 `"unscoped"`
- `repoRelativePath`: repo root 기준 상대경로

`document_search` 결과도 동일한 repo 메타데이터를 포함한다(`repoId`, `repoRelativePath`).

### Default deny for cross-repo edits

`change`/`write`는 기본적으로 cross-repo 편집을 차단한다.

- 허용 조건(모두 필요):
  - tool args: `allowCrossRepoEdits: true`
  - 각 repo config: `allowCrossRepoEdits: true`
  - repo type이 `reference`면 항상 차단

### Typed reasons

repo 경계 위반은 `degradedReasons`/`blockedReason`에 typed reason으로 표기한다.

- `cross_repo_scope_mismatch`
- `cross_repo_edit_blocked`

## Implementation Notes

- RepoScope/메타데이터 정규화: `src/utils/RepoScope.ts`
- repo 편집 가드: `src/orchestration/pillars/shared/RepoGuard.ts`
- `project_search` repo 메타데이터 + repoScope 필터: `src/handlers/SearchHandlers.ts`
- `document_search` repoScope 필터 + repo 메타데이터: `src/handlers/DocumentHandlers.ts`, `src/documents/search/SearchTypes.ts`
- `explore`/`navigate` 결과에 repo 메타데이터 포함: `src/orchestration/pillars/explore/ExplorePillar.ts`, `src/orchestration/pillars/NavigatePillar.ts`
- `change`/`write` default deny 적용: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`
- Config bootstrap safe default: `src/config/ConfigBootstrapper.ts` (`allowCrossRepoEdits` 기본 false)
- ToolSpec 확장: `src/server/tools/ToolSpecRegistry.ts`

## Testing

- Search repo 경계/필터: `src/tests/handlers/SearchHandlers.test.ts`
- 멀티레포 E2E(검색 메타 + 차단): `src/tests/integration/MultiRepoToolSurface.e2e.test.ts`
