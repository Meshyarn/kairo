# ADR-081: GraphRAG Hybrid Cluster Retrieval

**Status:** Implemented (0.4.27 baseline)  
**Date:** 2026-01-18  
**Related:** `docs/adr/ADR-054-cross-language-contract-awareness.md`, `docs/adr/ADR-074-token-budget-allocator-v2-cross-pillar-summary-reuse.md`, `docs/adr/ADR-076-symbol-semantic-search-e2e-integrate-or-deprecate.md`

## Why
Flat-list retrieval tends to trigger follow-up calls (additional search/read), increasing token waste and repeated exploration cost.  
GraphRAG aims to “pick strong seeds (lexical/semantic), expand within budget using graph signals (call/type/dependency), and directly return **cluster-level context**.”

## What shipped
- **Seed policy (dynamic selection) + fallback:**
  - choose `path_first` / `symbol_semantic` / `doc_first` / `lexical_default` based on path/symbol/document hints
  - if semantic seeding is unavailable (or `doc_first` has no eligible doc seeds), degrade to `lexical_default` (`graphrag_policy_degraded`)
- **DependencyGraph relationships:** include import/export relationships as `dependency` relationships (`imports-from` / `exports-to`).
- **Cluster summary response (first-class context):**
  - return `clusters: ClusterSummary[]` when `include.clusters=true` in `explore`/`understand`/`navigate`
  - include the policy name via `clusterPolicy`
- **Cross-boundary auto-expand (allowlist + caps):**
  - start with a boundary-kind allowlist (`ffi_napi`, `idl_proto`, `http_openapi`, `db_sql_schema`) as the only targets for auto-expansion into code
  - apply autoScale caps based on project size (fileCount) (S/M/L tier; caps include `maxDepth/maxFiles/maxSymbols/maxTokens`)
  - allow cross-repo expansion only when repoScope + per-repo `allowCrossRepoEdits` + tool input `allowCrossRepoEdits` are all satisfied
- **Explainability:** expose `graphrag_*` reason codes in `degradedReasons`, and record selection rationale via trace/metrics

## How to enable
- Enable (either one):
  - `KAIRO_GRAPHRAG_ENABLED=true`
  - set `"enabled": true` in `.kairo/config/graphrag.json` (base dir can be changed via `KAIRO_DIR`; legacy: `KAIRO_DIR/graphrag.json`; for `.mcp`, set `KAIRO_ALLOW_LEGACY_MCP_DIR=true`)
- Calls (examples):
  - `explore({ query: "auth flow", include: { clusters: true } })`
  - `understand({ goal: "src/auth", include: { clusters: true } })`
  - (for cross-repo expansion) `allowCrossRepoEdits: true` + set `allowCrossRepoEdits: true` for relevant repos in `.kairo/config/.mcp-config.json`
- Scale tier thresholds (env vars):
  - `KAIRO_SCALE_TIER_S_MAX_FILES` (default: 5000), `KAIRO_SCALE_TIER_M_MAX_FILES` (default: 50000)

## Output signals
- `clusters: ClusterSummary[]` + `clusterPolicy`
- `ClusterSummary.relationships.*.state`:
  - `not_loaded` / `loaded` / `truncated` / `failed`
- `ClusterSummary.crossBoundary`:
  - `kind`, `autoExpanded`, `truncated`
- `degradedReasons`:
  - `graphrag_disabled`, `graphrag_policy_degraded`, `graphrag_cross_boundary_blocked`, `graphrag_budget_exceeded`, etc.

## Key code paths
- GraphRAG config + loader: `src/config/GraphRagConfig.ts`
- Cluster service (seed policy + cross-boundary gating): `src/orchestration/cluster/GraphRagClusterService.ts`
- Cluster search seeded path: `src/engine/ClusterSearch/index.ts`
- Dependency relationship building: `src/engine/ClusterSearch/ClusterBuilder.ts`
- Tool schema surface: `src/server/tools/ToolSpecRegistry.ts`

