# Promptless MCP Integration

This guide shows how to connect Kairo to an MCP host without adding any special system prompt. The goal is to keep the tool surface compact, keep stdout clean, and rely on the `task` tool for most workflows.

## Recommended defaults

Use these values in your host environment:

- `KAIRO_MODE=mcp` (default; set `dev` to opt out)
- `KAIRO_PRESET=mcp-lean` (or `mcp-balanced` for bigger repos)
- `KAIRO_PUBLIC_SURFACE=compact`
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`
- `KAIRO_ROOT_PATH=/absolute/path/to/repo` (or pass `--root` in args)

Why:
- `compact` surface keeps `list_tools` small and stable (only `task` + `manage`).
- `compat` schema mode prevents hard failures when hosts add extra fields.
- log-to-file avoids breaking MCP frames on stdout.

## Optional policy file (recommended)

Persist MCP policy under `.kairo/config/mcp.json`:

```json
{
  "version": 1,
  "mode": "mcp",
  "preset": "mcp-lean",
  "publicSurface": "compact",
  "autopilot": {
    "autoModeNeverApplies": true,
    "defaultOutputFormat": "summary",
    "maxAutoRepairAttempts": 2,
    "allowAutoReindex": true
  },
  "applyHandshake": {
    "required": true,
    "oneTime": true,
    "invalidateOnDrift": true
  },
  "timeboxMs": {
    "total": 15000,
    "perStep": 3000
  }
}
```

Notes:
- Use `manage({ command: "schema", tool: "task", detail: "full" })` to fetch the full task schema.
- If you want full pillar tools instead of `task`, switch `publicSurface` to `pillars`.

## Beta telemetry (optional)

Enable the beta log when you want to collect real-world usage without prompts:

```
KAIRO_BETA_LOG_ENABLED=true
```

Entries are written to `.kairo/logs/beta.ndjson` by default.

## Host config templates

### Generic stdio block

Most MCP hosts accept the same core fields even if the surrounding JSON differs:

```json
{
  "command": "node",
  "args": ["/abs/path/to/kairo/dist/index.js", "--root", "/abs/path/to/repo"],
  "timeout": 300000,
  "env": {
    "NODE_OPTIONS": "--max-old-space-size=4096",
    "KAIRO_MODE": "mcp",
    "KAIRO_PUBLIC_SURFACE": "compact",
    "KAIRO_LOG_TO_FILE": "true",
    "KAIRO_ALLOW_STDOUT_LOGS": "false"
  }
}
```

If your host uses `mcpServers` or `servers`, place this block under a server entry named `kairo`.

### VS Code (`.vscode/mcp.json`)

Kairo can generate this for you:

```json
{
  "inputs": [],
  "servers": {
    "kairo": {
      "type": "stdio",
      "command": "node",
      "cwd": "${workspaceFolder}",
      "args": ["--max-old-space-size=8196", "${workspaceFolder}/dist/index.js"],
      "env": {
        "KAIRO_LOG_TO_FILE": "true",
        "KAIRO_ALLOW_STDOUT_LOGS": "false",
        "KAIRO_WASM_DIR": "${workspaceFolder}/wasm"
      }
    }
  }
}
```

Generate a patch with:

```
manage({ command: "init", mode: "plan", targets: ["vscode"] })
```

## Promptless usage flow

Treat `task` as the only entrypoint for the model:

```json
{
  "request": "Summarize the entrypoint and main dependencies.",
  "mode": "ask",
  "budget": "lean",
  "paths": ["src"]
}
```

When you need deeper options, fetch a schema on demand:

```json
{
  "command": "schema",
  "tool": "task",
  "detail": "full"
}
```

Safe change flow:
1. `task` with `mode="plan_change"` (returns `draftId` + `applyToken`)
2. `task` with `mode="apply_change"` + `applyToken`

## Troubleshooting (no prompts)

- `manage({ command: "status" })` for drift, index health, and workflow status.
- `manage({ command: "doctor", scope: "host" })` for host config checks.
- `manage({ command: "artifacts" })` to list artifacts and `manage({ command: "artifact", target: "<id>" })` to read them.
- If the root is wrong, always pass `--root` or `KAIRO_ROOT_PATH`.
- If a host has strict JSON parsing, keep stdout clean (`KAIRO_ALLOW_STDOUT_LOGS=false`) and rely on `KAIRO_LOG_TO_FILE`.

For full tool details, see `docs/agent/TOOL_REFERENCE.md`.
