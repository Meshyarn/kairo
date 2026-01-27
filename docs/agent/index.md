# Agent Docs

This section documents **what an agent framework should expect** from Kairo’s public tool surface.

Start here:

- [Quick Reference](/agent/quick-reference) — practical host integration cheat-sheet
- [Tool Reference (Public Surface)](/agent/TOOL_REFERENCE) — the stable contract (compact + pillars)
- [Agent Playbook](/agent/AGENT_PLAYBOOK) — recommended usage patterns (evidence packs + compact follow-ups)

## Framework-friendly defaults

If you want Kairo to be used frequently, prefer:

- `KAIRO_PUBLIC_SURFACE=compact` (`task` + `manage`)
- `KAIRO_TOOL_SCHEMA_MODE=compat` (tolerates extra fields from hosts)
- `KAIRO_ALLOW_STDOUT_LOGS=false` + `KAIRO_LOG_TO_FILE=true` (don’t break stdio frames)

## Host integration tips

- Prefer executing `guidance.nextCalls` verbatim (especially for apply flows).
- When you need deeper evidence, fetch packs via `manage({ command: "artifact", target, detail: "full" })`.
- If you’re routing tool calls in a framework, serialize apply operations (plan/apply tokens are one-time).
