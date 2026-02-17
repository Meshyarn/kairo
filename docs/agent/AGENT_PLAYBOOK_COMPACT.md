# Agent Playbook (Compact Surface)

> Public compact surface only: `task`, `manage`

This playbook is for hosts that expose only compact tools and need deterministic next steps.

---

## Recommended host defaults

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact`
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`

---

## Response contract to trust

Treat compact responses as actionable when:

- `status` is `success` or `partial_success`
- `evidence` exists (when search results exist)
- top-level `nextCalls` exists (follow these first)

Always prefer `nextCalls` over handcrafted retries, especially for apply flows that require one-time tokens.

---

## Core compact workflows

### 1. Ask (default read-only)

```json
{ "request": "Summarize the auth flow." }
```

### 2. Analyze (structure-focused)

```json
{ "request": "Explain module boundaries.", "mode": "analyze", "profile": "balanced" }
```

### 3. Deep evidence + artifact fetch

```json
{ "request": "Explain architecture with evidence.", "mode": "analyze", "profile": "deep" }
```

If artifacts are returned:

```json
{ "command": "artifact", "target": "<artifactId>", "detail": "full" }
```

### 4. Change plan prep (no edits yet)

```json
{
  "request": "Tighten JWT validation.",
  "mode": "plan_change",
  "targetFiles": ["src/auth/jwt.ts"]
}
```

When `prepRequired=true`, use returned template/targets and call `plan_change` again with concrete `edits`.

### 5. Change apply patterns

Standard two-phase:

```json
{ "request": "Tighten JWT validation.", "mode": "plan_change", "edits": [{ "filePath": "src/auth/jwt.ts", "targetString": "OLD", "replacementString": "NEW" }] }
```

Then:

```json
{ "request": "Apply the plan.", "mode": "apply_change", "draftId": "<draftId>", "applyToken": "<applyToken>" }
```

One-shot small change (opt-in):

```json
{
  "request": "Tighten JWT validation.",
  "mode": "plan_change",
  "safety": "auto",
  "targetFiles": ["src/auth/jwt.ts"],
  "edits": [{ "filePath": "src/auth/jwt.ts", "targetString": "OLD", "replacementString": "NEW" }]
}
```

This auto-applies only when server policy allows it (`KAIRO_ENABLE_AUTO_APPLY=true`) and guardrails pass.

### 6. Write + verify

Plan write:

```json
{
  "request": "Create src/foo.ts with:\n```ts\nexport const foo = 1;\n```",
  "mode": "write",
  "safety": "plan",
  "targetPath": "src/foo.ts"
}
```

Apply write:

```json
{ "request": "Apply write.", "mode": "write", "safety": "apply", "draftId": "<draftId>", "applyToken": "<applyToken>" }
```

Verify:

```json
{ "request": "Verify draft alignment.", "mode": "verify", "draftId": "<draftId>", "targetPath": "src/foo.ts" }
```

---

## Compact-specific rules

- Prefer `profile` terminology (`budget`/`depth` remain aliases).
- Use `pillarOptions` only when advanced passthrough is necessary.
- Treat `applyToken` as single-use.
- If blocked, re-plan instead of replaying apply.
- If `degraded=true`, run the surfaced `nextCalls` first.

---

## Self-documenting calls

Get task schema summary:

```json
{ "command": "schema", "tool": "task", "detail": "summary" }
```

Read full docs from MCP resources:

- `kairo://docs/agent-playbook-compact`
- `kairo://docs/quick-reference`
- `kairo://docs/tool-reference`
