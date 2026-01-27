# Pick your defaults

Kairo is intentionally configurable, but most frameworks should converge on a small set of “boring defaults” that maximize tool-call reliability.

## Baseline defaults (recommended)

Use these unless you have a specific reason not to:

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact`
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`

## Presets: choose by repo size + depth

| Scenario | Suggested preset | Notes |
|---|---|---|
| Small/medium repo, fast loops | `KAIRO_PRESET=mcp-lean` | Lowest overhead; good default. |
| Larger repo, higher recall | `KAIRO_PRESET=mcp-balanced` | More depth; slightly more cost. |
| Deep audits, big repos | `KAIRO_PRESET=mcp-deep` | Highest cost; prefer timeboxing. |

## Framework routing defaults (what to implement first)

1. Prefer `task` for almost everything.
2. Fetch depth via `manage` artifacts instead of adding prompts.
3. Treat writes as “plan-first” and only apply after explicit approval.

See:

- [Public Surfaces](/concepts/public-surface)
- [Tool Reference](/agent/TOOL_REFERENCE)

