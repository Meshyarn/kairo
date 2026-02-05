# Performance & Reliability

Kairo is designed to run as a **stdio MCP server** under a host (IDE/agent) that enforces permissions and timeouts. Reliability issues usually come from one of three places:

1) **Stdout framing breaks** (logs mixed into MCP frames)  
2) **Cold or stale indexes** (slow first calls, drift, partial coverage)  
3) **Host timeouts / resource limits** (long requests killed by the host)

This page focuses on the *current* knobs and the fastest diagnostics.

---

## Rule #1: Do not break stdout framing

Recommended defaults:

- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`
- Use `KAIRO_LOG_DIR` or `KAIRO_LOG_FILE` to route logs where you want them

See: [Logging & telemetry](/reference/configuration/logging-and-telemetry)

---

## Index health, drift, and “why did it get slower?”

Run:

```bash
manage({ command: "status", detail: "summary" })
```

High-signal fields:

- `nativeSearch.available` and `nativeSearch.stats.docCount` (lexical index readiness)
- `status.global.totalFiles` vs `status.global.indexedFiles` (coverage)
- `indexSnapshot.coverageRatio` and `indexSnapshot.staleRisk` (staleness)
- `drift.workspaceDrift` (external edits / drift detection)

Common fixes:

- Cold start: `manage({ command: "reindex" })`
- Drift repair: `manage({ command: "reindex", paths: [...] })` (targeted) → `manage({ command: "reindex" })` (full)

---

## Keep responses small (fewer timeouts, lower cost)

Preferred controls:

- Tool call caps: `limits.maxTokens`, `limits.maxChars`, `limits.timeoutMs`
- Server defaults: `.kairo/config/mcp.json` → `budgets` + `timeboxMs`
- Result size: `KAIRO_MAX_RESULTS`

See:
- [Budgets](/reference/configuration/budgets)
- [Project config files](/reference/configuration/project-files)

---

## Suggested baseline presets

Use presets as a starting point and tune from there:

- `KAIRO_PRESET=mcp-lean` for fast iteration and small outputs
- `KAIRO_PRESET=mcp-balanced` for team/shared environments
- `KAIRO_PRESET=mcp-deep` for agent loops and deep analysis

Presets can be set via env or via `.kairo/config/mcp.json`.

---

## Embeddings & vector index (optional)

If you enable embeddings, expect higher CPU/memory usage during initial builds.

Key knobs:

- `KAIRO_EMBEDDING_PROVIDER=auto|local|remote|disabled`
- `KAIRO_EMBEDDING_MODEL`, `KAIRO_EMBEDDING_PACK_FORMAT`
- `KAIRO_VECTOR_INDEX`, `KAIRO_VECTOR_INDEX_REBUILD`, `KAIRO_VECTOR_INDEX_SHARDS`

See: [Search & embeddings config](/reference/configuration/search-and-embeddings)

---

## When to suspect the host, not Kairo

If requests terminate mid-flight:

- Increase the host timeout (host-specific).
- Prefer smaller calls (caps + fewer results).
- Use `manage({ command: "status" })` to confirm the server is not degraded.

---

## Next

- [Performance baselines](/performance/baselines)
- [Deployment scenarios](/guides/deployment-scenarios)
- [Ops runbook](/guides/ops-runbook)
