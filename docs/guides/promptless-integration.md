# Promptless MCP Integration

This guide shows how to connect Kairo to an MCP host without adding any special system prompt. The goal is to keep the tool surface compact, keep stdout clean, and rely on the `task` tool for most workflows.

> Tool name note: Some MCP hosts display tools with a server prefix (e.g. `kairo_task`). The canonical tool names are `task` and `manage`.

## Recommended defaults

Use these values in your host environment:

- `KAIRO_MODE=mcp` (default; set `dev` to opt out)
- `KAIRO_PRESET=mcp-balanced` (default; or `mcp-deep` for bigger repos)
- `KAIRO_PUBLIC_SURFACE=compact`
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`
- `KAIRO_ROOT_PATH=/absolute/path/to/repo` (or pass `--root` in args)

Why:
- `compact` surface keeps `list_tools` small and stable (only `task` + `manage`).
- `compat` schema mode prevents hard failures when hosts add extra fields.
- log-to-file avoids breaking MCP frames on stdout.

Rationale: `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md`.

## Optional policy file (recommended)

Persist MCP policy under `.kairo/config/mcp.json`:

```json
{
  "version": 1,
  "mode": "mcp",
  "preset": "mcp-balanced",
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

### Generate host snippets (recommended)

You can generate host-agnostic and host-specific MCP snippets with `manage init`:

```json
{
  "command": "init",
  "mode": "plan",
  "targets": ["host_snippets", "host_codex", "host_claude_cli", "host_gemini_cli"]
}
```

Generated files live under `.kairo/config/hosts/`. Copy the `server` block into your host config and replace the `/ABS/PATH/...` placeholders.

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

Note: As of ADR-086, `task` supports `mode="write"` and `mode="verify"` on the compact surface. These modes can still return `blocked` for safety/policy reasons (missing target path, apply token missing/expired/used, fileVersion drift, review/guardrail blocks, draft target mismatch). Switch to `KAIRO_PUBLIC_SURFACE=pillars` when you need full pillar-level options.

## Evidence Pack follow-up (ADR-087)

When you need depth without expanding the tool surface, ask `task` for a deep budget and then fetch the evidence pack via `manage`:

```json
{
  "request": "Explain the auth flow and key files.",
  "mode": "analyze",
  "budget": "deep"
}
```

Then:

```json
{
  "command": "artifact",
  "target": "<evidenceId>",
  "detail": "full"
}
```

Notes:
- `task` returns inline `evidence` plus an evidence-pack artifact id in `artifacts`.
- Use `output.maxTokens/maxChars` to cap response size; `task` will downshift LOD to fit.

When you need deeper options, fetch a schema on demand:

```json
{
  "command": "schema",
  "tool": "task",
  "detail": "full"
}
```

Safe change flow:
1. `task` with `mode="plan_change"`
   - if `edits` is omitted: returns prep (`editsTemplate` + target hints + fileVersions)
   - if `edits` is provided: returns `draftId` + `applyToken` (in MCP mode)
2. `task` with `mode="apply_change"` + `draftId` + `applyToken` (no need to re-send `targetFiles`/`edits`)
   - apply responses may include an embedded `verification` result; otherwise follow up with `task(mode="verify")` if you need confirmation.

Safe write flow:
1. `task` with `mode="write"` + `safety="plan"` + `targetPath`
   - include content in a fenced code block inside `request` (e.g. ```ts ... ```)
   - returns `draftId` + `applyToken` (in MCP mode)
2. `task` with `mode="write"` + `safety="apply"` + `draftId` + `applyToken`
   - do not override the draft target; mismatched `targetPath` is blocked for safety

## Troubleshooting (no prompts)

- `manage({ command: "status" })` for drift, index health, and workflow status (including `nativeSearch`).
- `manage({ command: "doctor", scope: "host" })` for host config checks.
- `manage({ command: "artifacts" })` to list artifacts and `manage({ command: "artifact", target: "<id>" })` to read them.
- If the root is wrong, always pass `--root` or `KAIRO_ROOT_PATH`.
- If a host has strict JSON parsing, keep stdout clean (`KAIRO_ALLOW_STDOUT_LOGS=false`) and rely on `KAIRO_LOG_TO_FILE`.

For full tool details, see `docs/agent/TOOL_REFERENCE.md`.
