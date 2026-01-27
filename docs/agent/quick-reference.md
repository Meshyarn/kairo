# Quick Reference (Agent Framework Developers)

This page is a practical cheat-sheet for integrating Kairo into an MCP host/framework.

## Recommended defaults

Use compact, promptless-friendly settings:

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact` (default tools: `task`, `manage`)
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`

## Common calls (compact surface)

### Ask / summarize

```json
{ "request": "Summarize the entrypoint." }
```

### Analyze (deeper)

```json
{ "request": "Explain the architecture.", "mode": "analyze", "budget": "balanced" }
```

### Deep evidence pack (progressive disclosure)

```json
{ "request": "Explain the architecture with evidence.", "mode": "analyze", "budget": "deep" }
```

Then fetch the artifact:

```json
{ "command": "artifact", "target": "<artifactId>", "detail": "full" }
```

### Plan → apply (change)

Plan (returns `draftId` + `applyToken` in MCP mode):

```json
{ "request": "Tighten JWT validation.", "mode": "plan_change", "targetFiles": ["src/auth/jwt.ts"] }
```

Apply (don’t re-send edits unless you have to):

```json
{ "request": "Apply the plan.", "mode": "apply_change", "draftId": "<draftId>", "applyToken": "<applyToken>" }
```

### Plan → apply (write)

Plan a write (include content in a fenced code block inside `request`):

```json
{
  "request": "Create `src/foo.ts` with:\\n```ts\\nexport const foo = 1;\\n```",
  "mode": "write",
  "safety": "plan",
  "targetPath": "src/foo.ts"
}
```

Apply the write:

```json
{ "request": "Apply.", "mode": "write", "safety": "apply", "draftId": "<draftId>", "applyToken": "<applyToken>" }
```

## Response handling rules (host/framework)

- Prefer executing `guidance.nextCalls` verbatim (it carries correct tokens/session context).
- Treat `status="blocked"` as a safety/policy gate (re-plan, narrow scope, refresh file versions).
- Treat `status="partial_success"` as success-with-guidance (follow suggested calls).
- Treat `applyToken` as **single-use**. Never retry apply with a reused token.

For full schemas and edge cases: see [Tool Reference](/agent/TOOL_REFERENCE).

