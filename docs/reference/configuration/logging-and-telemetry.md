# Logging & telemetry

Kairo runs as a stdio MCP server. The number one rule is: **do not break stdout framing**.

## Recommended defaults

| Variable | Recommended | Why |
|---|---|---|
| `KAIRO_LOG_TO_FILE` | `true` | Keeps stdout clean for MCP frames. |
| `KAIRO_ALLOW_STDOUT_LOGS` | `false` | Prevents random JSON parse failures in hosts. |
| `KAIRO_LOG_LEVEL` | `info` (or `debug` temporarily) | Use `debug` only during investigations. |
| `KAIRO_LOG_DIR` | *(optional)* | Overrides the default log directory (default: `<KAIRO_DIR>/logs`). |
| `KAIRO_LOG_FILE` | *(optional)* | Write all logs to a single file instead of per-stream files. |

Notes:

- Prefer file logs in MCP hosts. Any interleaved stdout output can break MCP JSON framing.
- If you need to diagnose host integration issues, collect logs + `manage({ command: "status" })` output and keep your tool calls deterministic (serialize apply flows).
- When `KAIRO_LOG_TO_FILE=true` and `KAIRO_LOG_FILE` is not set, Kairo writes to `KAIRO_LOG_DIR` (default: `<KAIRO_DIR>/logs`) using files like `console.log`, `console.warn.log`, `console.error.log`, `stdout.log`, `stderr.log`.

## Beta telemetry (opt-in)

| Variable | Purpose |
|---|---|
| `KAIRO_BETA_LOG_ENABLED` | Enable sanitized NDJSON usage log under `.kairo/logs/`. |
| `KAIRO_BETA_LOG_PATH` | Override beta log path. |
| `KAIRO_HOST_NAME` | Tag log entries for multi-host tests. |

See also:

- [Ops Runbook](/guides/ops-runbook)
