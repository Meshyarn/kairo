# Agent framework patterns

If you’re building a framework that routes tool calls, this is the intended integration posture for Kairo.

## Default posture: maximize call frequency

Do:

- Default to `KAIRO_PUBLIC_SURFACE=compact` and route most intents to `task`.
- Treat Kairo as **read-only by default** (until an explicit apply step).
- Prefer `guidance.nextCalls` when present (it reduces wiring bugs).

Avoid:

- Requiring special system prompts for Kairo to be usable.
- Expanding the tool surface early (it reduces stability for generic hosts).

## Recommended routing rules

1. “Need understanding/evidence?” → `task`
2. “Need deeper proof?” → `manage artifact`
3. “Need a safe edit?” → `task plan_change` then `task apply_change`
4. “Need full knobs?” → switch to pillars (`explore/understand/change/write`)

## Reliability rules that frameworks should enforce

- Serialize apply operations (one-time tokens).
- Keep stdout clean (do not let logs interleave with MCP frames).
- Persist `sessionId` per workflow when doing multi-step edits.

For deeper details:

- [Tool Reference](/agent/TOOL_REFERENCE)
- [ADR-084](/adr/ADR-084-mcp-autopilot-and-preset-layer)
- [ADR-088](/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program)

