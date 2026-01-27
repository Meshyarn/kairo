# First calls

These calls are designed to work in "promptless" integration setups.

## 1) Sanity check: status

Target tool: `manage`

```json
{ "command": "status" }
```

**Expected response shape:**

```json
{
  "success": true,
  "status": {
    "global": { "totalFiles": 123, "indexedFiles": 123, ... },
    "nativeSearch": { "available": true, "docCount": 500 },
    "drift": { "workspaceDrift": "clean" }
  }
}
```

**Success indicators:** `success: true` + `drift.workspaceDrift: "clean"` + `nativeSearch.available: true`

---

## 2) Find the entrypoint

Target tool: `task`

```json
{ "request": "Find the program entrypoint and summarize how it starts.", "mode": "ask" }
```

**Expected response shape:**

```json
{
  "success": true,
  "summary": { "title": "Entrypoint", "bullets": ["..."], "next": "..." },
  "evidence": [
    { "path": "src/index.ts", "kind": "file", "excerpt": "..." }
  ],
  "artifacts": [...]
}
```

**Success indicators:** `success: true` + non-empty `summary.bullets` + `evidence` array has at least 1 item

---

## 3) Explain the architecture

Target tool: `task`

```json
{ "request": "Explain the project architecture (major modules and data flow).", "mode": "analyze", "budget": "balanced" }
```

**Expected response shape:**

```json
{
  "success": true,
  "summary": { "title": "Architecture", "bullets": [...], "next": "..." },
  "evidence": [
    { "path": "src/core/Engine.ts", "kind": "file", "score": 0.95 },
    { "path": "docs/ARCHITECTURE.md", "kind": "doc", "excerpt": "..." }
  ],
  "artifacts": [ { "id": "arch_pack_123", "kind": "evidence", "summary": "..." } ]
}
```

**Success indicators:** Response includes both code files + docs in `evidence` + `artifacts` array is non-empty for deep dive

---

## 4) Ask for deeper evidence (artifact)

If the answer references an `artifacts` entry, fetch it for full details:

```json
{ "command": "artifact", "target": "<artifactId>", "detail": "full" }
```

**Expected response shape:**

```json
{
  "success": true,
  "artifact": {
    "id": "arch_pack_123",
    "kind": "evidence",
    "summary": "...",
    "files": [
      { "path": "src/core/Engine.ts", "role": "primary", "excerpt": "..." },
      { "path": "src/core/Worker.ts", "role": "supporting" }
    ]
  }
}
```

**Success indicators:** `success: true` + `artifact.files` contains detailed entries with paths and excerpts

---

## Next: Safe edits (plan → apply)

For code modifications, follow the two-phase pattern:

1. **Plan**: `task({ request: "Plan: ...", mode: "plan_change" })` → get `draftId`
2. **Apply**: `task({ ..., mode: "apply_change", draftId, applyToken })` → confirm success

See [Enable safe writes](/quickstart/enable-writes) for full example.

---

For more patterns: [Agent Playbook](/agent/AGENT_PLAYBOOK)

