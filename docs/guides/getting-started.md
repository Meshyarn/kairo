# Getting Started (Kairo)

Kairo is an MCP server that communicates over **stdio**. Your MCP host launches it and applies timeouts/permissions.

By default (`KAIRO_MODE=mcp`), Kairo exposes a **compact** tool surface (`task` + `manage`). If you want to call the Five Pillars directly, set `KAIRO_PUBLIC_SURFACE=pillars`.

## Requirements

- Node.js (modern LTS recommended)
- `npm` (or compatible)


## Run from this repo

```bash
cd kairo
npm ci
npm run build
node dist/index.js --root /absolute/path/to/your/project
```

Runtime data (indexes/caches/logs) is stored under `.kairo/` in the target project root by default.

## Native core (search + performance)

Kairo uses a native module (`@kairo/core-rs`) for Tantivy-backed search and other performance-critical paths.

If you see `CAP_NATIVE_SEARCH_UNAVAILABLE` (or you are on an unsupported platform/arch), build it locally:

```bash
# requires a working Rust toolchain (cargo)
npm run build:core-rs
```

Quick smoke (spawns `dist/index.js` and calls tools over stdio):

```bash
npm run smoke:mcp-mock-client
```

## Search & embeddings (offline-first)

Kairo supports lexical search (native core) and optional vector search (embeddings + index). The detailed offline workflow lives in:

- [Search & Embeddings](/guides/search-and-embeddings)
- [Search & embeddings config](/reference/configuration/search-and-embeddings)

## Use as an MCP server (example config)

Point your MCP host at the built entry (Claude CLI / Gemini CLI / Codex CLI all have a concept of “stdio MCP server”; the config shape differs per tool but these fields are the same):

```json
{
  "command": "node",
  "args": ["/absolute/path/to/kairo/dist/index.js", "--root", "/absolute/path/to/your/project"],
  "timeout": 300000,
  "env": {
    "NODE_OPTIONS": "--max-old-space-size=4096",
    "KAIRO_MODE": "mcp",
    "KAIRO_PUBLIC_SURFACE": "compact",
    "KAIRO_LOG_TO_FILE": "true",
    "KAIRO_ALLOW_STDOUT_LOGS": "false",
    "KAIRO_MAX_RESULTS": "25"
  }
}
```

If your MCP host runs the server from a different working directory, always set `--root` (or `KAIRO_ROOT_PATH` / `KAIRO_ROOT`).

## Permissions (recommended)

Prefer a read-first workflow:

- In compact surface: allow `task` / `manage` by default
- If you expose pillars: allow `explore` / `understand` by default, and enable `change` / `write` only when you intend to apply edits

Some MCP hosts support allow/deny lists for tool names and shell commands. If yours does, start with read-only and expand gradually.

## Mixed-workflow resilience ([ADR-077](/adr/ADR-077-mixed-workflow-resilience))

Kairo assumes external edits can happen at any time. When drift is detected, follow the repair ladder:

1) Re-read the target file (`read`/`explore` view=full) and retry in dry-run.
2) Reindex only the changed paths when possible (`manage({ command: "reindex", paths: [...] })`).
3) Reindex the project (`manage({ command: "reindex" })`) if drift persists.
4) If still blocked, narrow the scope and provide explicit edits (targetString/replacementString).

Use `manage({ command: "status" })` to check `drift`, and `manage({ command: "history" })` to see recent checkpoints.

## First calls (learn by example)

See [Quickstart → First calls](/quickstart/first-calls) for detailed examples with expected response structures:

- Sanity check: `manage({ command: "status" })`
- Find entrypoint: `task({ request: "Find the program entrypoint", mode: "ask" })`
- Explain architecture: `task({ request: "Explain architecture", mode: "analyze", budget: "balanced" })`
- Fetch deep evidence: `manage({ command: "artifact", target: "...", detail: "full" })`

For code edits, follow the two-phase pattern:

1. **Plan**: `task({ request: "Plan: ...", mode: "plan_change", targetFiles: [...] })`
2. **Apply**: `task({ mode: "apply_change", draftId, applyToken })`

See [Enable safe writes](/quickstart/enable-writes) for full workflow.

---

## After Your First Call: Validation Checklist

Once you've made your first successful call, validate your setup before going further:

### 1. Verify MCP connection

```bash
# Check tool availability
task({ request: "What tools are available?", mode: "ask" })

# Expected: Response lists `task`, `manage`, and any available `guide` tools
```

### 2. Check project indexing health

```bash
manage({ command: "status" })
```

Look for:
- ✅ `status.global.totalFiles` and `status.global.indexedFiles` look reasonable for your repo
- ✅ `nativeSearch.available: true` (lexical search enabled)
- ✅ `indexSnapshot.coverageRatio` is close to `1` after a `manage({ command: "reindex" })`
- ✅ `drift.workspaceDrift: "clean"` (or `"unknown"` before first index)

### 3. Validate error handling

Make an intentionally bad request to verify guidance:

```bash
task({ request: "foobar gibberish impossible request", mode: "auto" })
```

Expected response structure:

```json
{
  "success": false,
  "error": "No matching symbols found",
  "guidance": [
    "Refine your search terms",
    "Try a broader query",
    "Use 'ask' mode for natural language"
  ]
}
```

### 4. Quick performance baseline

Run a typical query and note latency:

```bash
# Time this
task({ request: "List all exported functions", mode: "auto" })

# p50 (warm): should be 10-50ms
# p95 (cold): should be 50-200ms
```

If significantly slower, check [Performance & Reliability](/concepts/performance-and-reliability).

### 5. Logs are being captured

Verify logging setup:

```bash
# With `KAIRO_LOG_TO_FILE=true`, these should exist and have recent entries
tail -20 .kairo/logs/console.log
# (or set `KAIRO_LOG_FILE=/absolute/path/to/kairo.log` for a single log file)

# Should show: timestamps, operation names, no sensitive data
```

### 6. Next: Initialize for your environment

```bash
manage({ command: "init" })
```

This pre-warms indexes and caches for faster subsequent queries.

Then follow your deployment scenario:
- **Development:** [Development scenario](/guides/deployment-scenarios#scenario-1-development-local-machine)
- **Team:** [Team CI/CD scenario](/guides/deployment-scenarios#scenario-2-team-cicd-shared-container--build-system)
- **Production:** [Production Agent scenario](/guides/deployment-scenarios#scenario-3-production-agent-high-throughput)

---


See `README.md` for the public overview.

## Next

- Configuration (split reference): `/reference/configuration/`
- Promptless MCP setup: `docs/guides/promptless-integration.md`
- Ops runbook: `docs/guides/ops-runbook.md`
