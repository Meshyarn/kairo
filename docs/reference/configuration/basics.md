# Basics

Most frameworks only need a handful of configuration knobs.

If you want a recommended starting posture, see:

- [Pick your defaults](/quickstart/pick-your-defaults)

## Common env vars

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_ROOT_PATH` | Project root to analyze. | Preferred over cwd; equivalent to `--root` CLI arg. |
| `KAIRO_ROOT` | Project root to analyze. | Alias for `KAIRO_ROOT_PATH`. |
| `KAIRO_MODE` | Policy mode. | `mcp` (default), `dev`, or `ci`. Set `dev` to opt out of MCP defaults. |
| `KAIRO_PRESET` | MCP preset. | `mcp-lean` (default), `mcp-balanced`, `mcp-deep`. |
| `KAIRO_PUBLIC_SURFACE` | Public tool surface. | `compact` (default in mcp; `task`+`manage` only) or `pillars` (Five Pillars). |
| `KAIRO_DIR` | Data directory. | Defaults to `.kairo` (contains index/cache/history). |
| `KAIRO_ALLOW_LEGACY_MCP_DIR` | Allow legacy `.mcp` paths for `KAIRO_DIR`. | (Deprecated) Set to `true` to permit `.mcp`/`.mcp/kairo`; otherwise Kairo uses `.kairo`. |
| `KAIRO_MAX_RESULTS` | Search result cap. | Lower for token-efficiency; raise for recall. |
| `KAIRO_LOG_LEVEL` | Structured logging level. | `debug|info|warn|error`. |
| `KAIRO_LOG_TO_FILE` | Persist logs under `.kairo`. | Prefer this in MCP hosts (keeps stdout clean). |
| `KAIRO_ALLOW_STDOUT_LOGS` | Allow stdout logs. | Avoid in MCP hosts; stdout is reserved for MCP frames. |
| `KAIRO_STORAGE_MODE` | Storage backend. | `file` (default) or `memory` (non-persistent). |
| `KAIRO_TOOL_SCHEMA_MODE` | Tool schema mode (contract enforcement). | `compat` (default) drops unknown top-level fields; `strict` rejects them. |
| `KAIRO_EXPOSE_INTERNAL_TOOLS` | Show internal tools in MCP `list_tools`. | Default `false`; internal tool names are unstable. |
| `KAIRO_EXPOSE_FILE_TOOLS` | Show compat file tools in MCP `list_tools`. | Default `false`; prefer the Five Pillars. |

Timeouts are primarily controlled by your MCP host (per-request timeout). Some operations also accept per-call timeouts via `limits.timeoutMs` (see [Tool Reference](/agent/TOOL_REFERENCE)).

## Deprecated env vars

These env vars still work but will be removed in a future release:

- `KAIRO_ROOT` → use `KAIRO_ROOT_PATH` or `--root`
- `KAIRO_EXPOSE_LEGACY_TOOLS` → use `KAIRO_EXPOSE_INTERNAL_TOOLS`
- `KAIRO_EXPOSE_COMPAT_TOOLS` → use `KAIRO_EXPOSE_FILE_TOOLS`
- `KAIRO_ALLOW_LEGACY_MCP_DIR` → legacy `.mcp` paths are deprecated

