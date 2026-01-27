# MCP host checklist (stdio)

Most “it fails randomly” MCP issues are host integration issues, not model issues.

Use this checklist when wiring Kairo as a stdio server.

## Required

- **Root path**: always pass `--root` (or `KAIRO_ROOT_PATH`) if the host cwd differs.
- **Timeouts**: allow long requests (search + indexing can take time on first runs).
- **Stdout cleanliness**: keep stdout reserved for MCP frames.
  - Prefer `KAIRO_LOG_TO_FILE=true`
  - Prefer `KAIRO_ALLOW_STDOUT_LOGS=false`
- **Concurrency**: serialize apply flows (draft tokens are one-time).

## Strongly recommended

- `KAIRO_TOOL_SCHEMA_MODE=compat` to tolerate host-added fields.
- Capture `manage({ command:"status" })` in diagnostics paths (drift, index health, native core).
- Prefer executing `guidance.nextCalls` verbatim.

## Common pitfalls

- Host prepends tool name prefixes (e.g. `kairo_task`). The canonical names remain `task`/`manage`.
- Logs written to stdout break MCP JSON framing (causes “random parse errors”).
- Missing or reused apply tokens cause “blocked” responses in write flows.

See:

- [Promptless MCP Integration](/guides/promptless-integration)
- [Ops Runbook](/guides/ops-runbook)

