# Agent Framework Integration (MCP Host Checklist)

This page is for **agent framework developers** (e.g., people building a new IDE extension or agent runtime) who need to launch Kairo programmatically.

> **Note:** If you just want to configure Kairo for an existing tool (like Cursor, Claude Desktop, or VS Code), see [Promptless MCP Integration](/guides/promptless-integration) instead.

Goal: make Kairo something your agent can **trust** and therefore **call often**.

## Recommended defaults (host-side)

Start with a compact, promptless-friendly configuration:

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact` (expose only `task` + `manage`)
- `KAIRO_TOOL_SCHEMA_MODE=compat` (tolerate extra host fields)
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`
- Always pass `--root /abs/path/to/repo` (or set `KAIRO_ROOT_PATH`)

Reference: [Promptless MCP Integration](/guides/promptless-integration)

## Stdio reliability requirements

If your host is implementing stdio MCP, these are the common failure points:

- **Stdout must be reserved for MCP frames.** Any non-protocol stdout corrupts the stream.
- Prefer treating **stderr as logs** (or keep logs in a file).
- If your runtime pipes/merges streams, ensure logs never interleave with JSON-RPC output.
- If your host supports it, implement **request timeouts + cancellation**.

## Tool naming and routing

Some MCP hosts prefix tool names (e.g. `kairo_task`). Your framework should:

- Use the tool names returned by `list_tools` (don’t hardcode prefixes).
- Treat **`task` as the default entrypoint** (compact surface).
- Call `manage({ command: "schema", tool: "task", detail: "full" })` when you need the full schema.

## Apply handshake (plan → apply)

Kairo’s trust model assumes a **two-phase contract**:

1. **Plan** returns a draft pack (`draftId`) and, in MCP mode, a **one-time** `applyToken`.
2. **Apply** requires `draftId + applyToken`.
3. If anything changes (drift), apply can be blocked and the agent should re-plan.

Framework tips:

- Treat `applyToken` as **single-use** and don’t cache it across retries.
- Prefer executing `guidance.nextCalls` when present (it carries the correct `draftId/applyToken/sessionId`).
- Serialize “apply” calls per server/session to avoid token races.

## Handling “blocked” and “partial_success”

Your framework should treat Kairo responses as actionable:

- `status="partial_success"`: show the summary + follow suggested calls (e.g. fetch an artifact, narrow scope).
- `status="blocked"`: treat as a safety/policy gate, not a crash. Re-plan with narrower scope or refresh file versions.

Common reasons for blocks:

- Missing/expired/used `applyToken`
- Draft target mismatch (host re-sent an inconsistent `targetPath`)
- Drift (file changed between plan and apply)
- Policy/guardrails block (review/semantic constraints)

## Observability hooks

For production integration:

- Use `manage({ command: "status" })` to surface health (drift, native search availability, workflow state).
- Use `manage({ command: "doctor", scope: "host" })` when diagnosing host config issues.
- Enable beta telemetry only when needed: `KAIRO_BETA_LOG_ENABLED=true` (writes to `.kairo/logs/beta.ndjson`).

## E2E trust verification

If you’re changing host routing logic, test the handshake end-to-end:

- Read: [ADR-088](/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program)
- Run the smoke suites in `scripts/adr-088-*.mjs` (especially change/write apply flows).

