# Change/write & drift

Kairo’s write safety is built around a plan → apply handshake with drift-aware blocking.

## Core knobs

| Variable | Purpose |
|---|---|
| `KAIRO_MODE` | `mcp` enables server-side apply gating; `dev` opts out of MCP defaults. |
| `KAIRO_TOOL_SCHEMA_MODE` | `compat` (recommended) vs `strict`. |
| `KAIRO_PUBLIC_SURFACE` | `compact` vs `pillars`. |

## Manage import safety

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_MANAGE_IMPORT_ALLOW_EXTERNAL` | Allow `manage import` outside `.kairo`. | Default `false`; opt in only when needed. |

## Drift checks (ADR-077)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_DRIFT_CHECK_MAX_FILES` | Max indexed files sampled when computing workspace drift. | Default 200. |
| `KAIRO_FORMATTER_MAX_FILES` | Max files for formatter bridge apply. | Default 10. |
| `KAIRO_FORMATTER_ALLOW_UNTRACKED` | Allow formatter bridge to write even when undo/rollback is available (untracked by history). | Default `false`. |
| `.kairo/config/scopes.json` | Manual scope overrides. | Optional; defines `serviceRoot` scopes for drift grouping. |

## Integrity audit (ADR-041)

| Variable | Purpose |
|---|---|
| `KAIRO_INTEGRITY_MODE` | Default integrity behavior. |
| `KAIRO_INTEGRITY_SCOPE` | Default scope (`docs` vs `project` vs `auto`). |
| `KAIRO_INTEGRITY_BLOCK_POLICY` | Whether high-severity findings block apply. |

## Writer’s flow defaults (ADR-051)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_WRITERS_FLOW_DEFAULT_DRYRUN` | Default dry-run for writer flow when sessionId is present. | `on|off|beta|canary` |
| `KAIRO_WRITERS_FLOW_REVIEW_DEFAULTS` | Enable session-based reviewOptions defaults. | `on|off|beta|canary` |

## StylePack cache (ADR-051)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_STYLE_PACK_TTL_MS` | Cache TTL for StylePack reuse across sessions. | Default: `1800000` (30 min). |
| `KAIRO_STYLE_PACK_CACHE_SIZE` | Max cached StylePacks. | Default: `50`. |
| `KAIRO_CALLGRAPH_MAX_NODES` | Max nodes stored in call graph artifacts. | Default: `500`. |
| `KAIRO_CALLGRAPH_MAX_EDGES` | Max edges stored in call graph artifacts. | Default: `1500`. |

## Raw content sources (ADR-089)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_CONTENT_SOURCE_MAX_BYTES` | Max bytes allowed for `contentSource.kind="file"` reads. | Default `1048576` (1MB). |

## Verify exec (opt-in)

Run allowlisted verification commands during `task(mode="verify")`.

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_VERIFY_EXEC_ENABLED` | Enable verify exec (global gate). | Default `false`. Requires config allowlist. |

Config file (disabled by default):

```json
{
  "version": 1,
  "enabled": false,
  "allowedCommands": [
    { "id": "js:test", "cmd": "npm", "args": ["test"], "timeoutMs": 600000 }
  ]
}
```

Save as `.kairo/config/verify-exec.json`, then call `task` with:

```json
{ "request": "Verify changes", "mode": "verify", "verifyExec": { "enabled": true, "ids": ["js:test"] } }
```

For usage flows:

- [Safe Writes concepts](/concepts/safe-writes)
- [Raw Content Sources guide](/guides/raw-content)
- [Tool Reference](/agent/TOOL_REFERENCE)
