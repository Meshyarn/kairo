# Initialization & Performance Tuning

After connecting to your MCP host, Kairo can run immediately, but performance improves once indexes and optional config files are in place.

**Time:** 10–30 min | **Difficulty:** Intermediate

---

## Part A: Bootstrap project config (recommended)

Kairo’s project-local config lives under `.kairo/config/` in the **target project root**.

Generate a starter skeleton with the `manage` tool:

```bash
# Plan only (no files written)
manage({ command: "init", mode: "plan" })

# Write `.kairo/config/*`
manage({ command: "init", mode: "apply" })
```

Most teams should prefer config files over lots of host env vars.

See: [Project config files](/reference/configuration/project-files)

---

## Part B: Build indexes (recommended)

Run a full reindex once after wiring the host:

```bash
manage({ command: "reindex" })
```

For drift repairs or large monorepos, prefer targeted reindex when you can:

```bash
manage({ command: "reindex", paths: ["src/index.ts", "packages/app/"] })
```

---

## Part C: Validate your setup

Run:

```bash
manage({ command: "status", detail: "summary" })
```

What to look for:

- `nativeSearch.available: true` (lexical search enabled)
- `status.global.totalFiles` / `status.global.indexedFiles` look reasonable
- `indexSnapshot.coverageRatio` close to `1` after a successful `reindex`
- `drift.workspaceDrift: "clean"` (or `"unknown"` before first index)
- If `symbolIndex.degradedReasons` includes `symbol_embeddings_not_built`, build embeddings/indexes per your embedding settings

---

## Part D: Common tuning knobs (current)

### Preset & surface (recommended)

Prefer `.kairo/config/mcp.json` for defaults like `preset`, `publicSurface`, `budgets`, and `timeboxMs`.

See:
- [MCP mode config](/reference/configuration/project-files)
- [Budgets](/reference/configuration/budgets)

### Embeddings & vector index (optional)

Key env vars (see the reference pages for details):

- `KAIRO_EMBEDDING_PROVIDER=auto|local|remote|disabled` (offline-first: use `local` or `disabled`)
- `KAIRO_EMBEDDING_MODEL`, `KAIRO_EMBEDDING_PACK_FORMAT`, `KAIRO_VECTOR_INDEX`, `KAIRO_VECTOR_INDEX_REBUILD`, `KAIRO_VECTOR_INDEX_SHARDS`

See:
- [Search & embeddings](/reference/configuration/search-and-embeddings)

### Storage paths (recommended)

- `KAIRO_DIR` controls where runtime data lives (default: `.kairo` under the target project root).
- `KAIRO_STORAGE_MODE=file|memory` controls persistence.

See:
- [Storage](/reference/configuration/storage)

### Logging (strongly recommended in MCP)

Keep stdout clean (MCP framing) and log to files:

- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_LOG_DIR` / `KAIRO_LOG_FILE` for path control
- `KAIRO_ALLOW_STDOUT_LOGS=false`

See:
- [Logging & telemetry](/reference/configuration/logging-and-telemetry)

---

## Troubleshooting (high-signal)

### Native search unavailable

If `nativeSearch.available` is false, build the native module:

```bash
npm run build:core-rs
```

### Indexing is slow or times out

- Increase timeout in your MCP host config (host-specific).
- Prefer `manage({ command: "reindex", paths: [...] })` for incremental repairs.
- If embeddings are enabled, tune `KAIRO_EMBEDDING_*` and `KAIRO_VECTOR_INDEX_*` to match your hardware.

### Host JSON framing errors

Ensure:

- `KAIRO_ALLOW_STDOUT_LOGS=false`
- `KAIRO_LOG_TO_FILE=true`

---

## Next

- [Deployment scenarios](/guides/deployment-scenarios)
- [Getting started](/guides/getting-started)
- [Search & embeddings](/guides/search-and-embeddings)

