# ADR-081 (Summary): GraphRAG Hybrid Cluster Retrieval

**Status:** Implemented (0.4.27 baseline)  
**Date:** 2026-01-18  
**Related:** `docs/adr/ADR-054-cross-language-contract-awareness.md`, `docs/adr/ADR-074-token-budget-allocator-v2-cross-pillar-summary-reuse.md`, `docs/adr/ADR-076-symbol-semantic-search-e2e-integrate-or-deprecate.md`

## Why
flat list 기반 retrieval은 follow-up 호출(추가 search/read)을 유발하고, 토큰 낭비와 반복 탐색 비용이 커졌다.  
GraphRAG는 “좋은 seed를 잡고(lexical/semantic), 그래프 신호(call/type/dependency)로 예산 내 확장하여 **클러스터 단위 컨텍스트**를 바로 제공”하는 것을 목표로 한다.

## What shipped
- **Seed policy(동적 선택) + fallback:**
  - path 힌트/심볼 힌트/문서 힌트에 따라 `path_first` / `symbol_semantic` / `lexical_default` 등을 선택
  - semantic이 불가하면 `lexical_default`로 degrade (`graphrag_policy_degraded`)
- **DependencyGraph 관계 포함:** import/export 관계를 `dependency` relationship로 포함(`imports-from` / `exports-to`)
- **Cluster summary 응답(1st-class context):**
  - `explore`/`understand`/`navigate`에서 `include.clusters=true`일 때 `clusters: ClusterSummary[]` 반환
  - `clusterPolicy`로 policy 이름을 함께 제공
- **Cross-boundary auto-expand (allowlist + caps):**
  - boundary kind allowlist(`ffi_napi`, `idl_proto`, `http_openapi`, `db_sql_schema`)만 “코드까지 자동 확장” 대상으로 시작
  - 프로젝트 규모(fileCount) 기반 autoScale caps 적용(S/M/L tier)
  - repoScope + repo allowCrossRepoEdits + tool input `allowCrossRepoEdits`를 모두 만족할 때만 cross-repo 확장 허용
- **Explainability:** `degradedReasons`에 `graphrag_*` reason code를 노출하고, trace/metrics로 선택 근거를 기록

## How to enable
- 켜기(둘 중 하나):
  - `KAIRO_GRAPHRAG_ENABLED=true`
  - `.kairo/config/graphrag.json`에서 `"enabled": true`
- 호출(예):
  - `explore({ query: "auth flow", include: { clusters: true } })`
  - `understand({ goal: "src/auth", include: { clusters: true } })`
  - (cross-repo 확장까지) `allowCrossRepoEdits: true` + `.kairo/config/mcp-config.json`에서 관련 repo들의 `allowCrossRepoEdits: true`

## Output signals
- `clusters: ClusterSummary[]` + `clusterPolicy`
- `ClusterSummary.relationships.*.state`:
  - `not_loaded` / `loaded` / `truncated` / `failed`
- `ClusterSummary.crossBoundary`:
  - `kind`, `autoExpanded`, `truncated`
- `degradedReasons`:
  - `graphrag_disabled`, `graphrag_policy_degraded`, `graphrag_cross_boundary_blocked`, `graphrag_budget_exceeded` 등

## Key code paths
- GraphRAG config + loader: `src/config/GraphRagConfig.ts`
- Cluster service (seed policy + cross-boundary gating): `src/orchestration/cluster/GraphRagClusterService.ts`
- Cluster search seeded path: `src/engine/ClusterSearch/index.ts`
- Dependency relationship building: `src/engine/ClusterSearch/ClusterBuilder.ts`
- Tool schema surface: `src/server/tools/ToolSpecRegistry.ts`

