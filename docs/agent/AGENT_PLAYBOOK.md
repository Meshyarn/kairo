# Agent Playbook

> **Public surface** — compact (`task`/`manage`) or Five Pillars

---

## Promptless default (compact surface)

When `KAIRO_MODE=mcp` (default), most hosts will see only `task` + `manage` (`KAIRO_PUBLIC_SURFACE=compact`).

Recommended flow:

```typescript
// Ask / read-only
task({ request: "Summarize the auth flow." })

// Analyze (structure/relationships)
task({ request: "Explain the architecture and key modules.", mode: "analyze", budget: "balanced" })

// Plan change (prep-only if edits are omitted)
const prep = await task({ request: "Tighten JWT validation.", mode: "plan_change", targetFiles: ["src/auth/jwt.ts"] })

// Plan change (real plan when edits are provided) → returns draftId + applyToken (MCP mode)
const plan = await task({ request: "Tighten JWT validation.", mode: "plan_change", edits: prep.changePrep?.editsTemplate?.edits })

// Apply requires draftId + applyToken
await task({ request: "Apply the plan.", mode: "apply_change", draftId: plan.draftId, applyToken: plan.applyToken })
```

Notes:
- `mode="auto"` never applies changes (server-gated).
- `mode="write"` / `mode="verify"` are supported on the compact surface (ADR-086). Use pillar tools when you need full per-pillar options.
- Use `manage({ command: "schema", tool: "task", detail: "full" })` when you need the full schema.

---

## The Five Pillars (pillars surface)

| Pillar | Intent | Example |
|--------|--------|----------|
| **`explore`** | Find or read | Search, preview, full reads |
| **`understand`** | Comprehend code | Architecture, call graphs, dependencies |
| **`change`** | Modify code | Safe edits with dry-run & impact |
| **`write`** | Create files | Generate, scaffold components |
| **`manage`** | Control state | Undo/redo, status, rebuild |

**Principle:** Express **"What"** (intent) → System handles **"How"** (execution)

---

## Common Patterns

### 1. Analyze → Modify
```typescript
// Step 1: Understand
understand({ goal: "Understand auth logic in UserService" })

// Step 2: Plan (server-gated; returns draftId/applyToken in MCP mode)
const plan = await change({ intent: "Add domain whitelist", safety: "plan" })

// Step 3: Verify diff + impact

// Step 4: Apply (MCP mode requires the returned applyToken)
await change({ ...plan, safety: "apply" })
```

### 1.2 StrategySearch (Best-of-N / MCTS)

If you can provide 2+ candidate patches as concrete `edits`, you can use `strategySearch` to compare candidates via dry-run and select one.

```typescript
const plan = await change({
  intent: "Tighten JWT validation",
  targetFiles: ["src/auth/jwt.ts"],
  safety: "plan",
  options: { includeImpact: true },
  strategySearch: {
    mode: "force",
    stage: "r1",
    candidates: [
      { id: "safe_small", edits: [{ filePath: "src/auth/jwt.ts", targetString: "OLD", replacementString: "NEW1" }] },
      { id: "fast_big", edits: [{ filePath: "src/auth/jwt.ts", targetString: "OLD", replacementString: "NEW2" }] }
    ]
  },
  trace: true
})
```

R3 (MCTS) runs a bounded search using the `children` tree + `mcts` settings. For full schema/output details, see `docs/agent/TOOL_REFERENCE.md`.

### 1.5 Writer's Flow (best review quality)

```typescript
// Step 0: Start a session
const { sessionId } = await explore({ query: "auth flow", research: { sketch: true }, sessionId: "new" })

// Step 1: Build session artifacts once
await understand({
  goal: "src/auth",
  sessionId,
  vibe: { extract: true, scope: "src/**/*.ts" },
  analysis: { clusters: true }
})

// Step 2: Plan first
const plan = await change({ intent: "Tighten JWT validation", targetFiles: ["src/auth/jwt.ts"], safety: "plan", sessionId })

// Step 3: Apply
await change({ ...plan, safety: "apply", sessionId })
```

Tip: `workflowMeta` + `workflowWarnings` make missing session artifacts visible without breaking legacy calls.
Tip: `analysis.clusters=true` requires GraphRAG to be enabled (`KAIRO_GRAPHRAG_ENABLED=true` or `.kairo/config/graphrag.json`).
Tip: To make semantic findings block apply, set `reviewOptions.blockOn=["semantic"]` and enable symbolic guards via `.kairo/config/symbolic-guards.json` (ADR-083).

### 2. Search → Deep Dive
```typescript
// Step 1: Find
explore({ query: "PaymentProcessor" })

// Step 2: Preview results

// Step 3: Full read (if needed)
explore({ paths: ["src/payments/Processor.ts"], view: "full" })
```

Tip: If results look empty or stale, use `manage({ command: "status" })` to check `nativeSearch`/`drift`, and run `manage({ command: "reindex" })` if needed.

---

## Response Structure

Every response includes **`guidance`**:
- `message` — What was achieved
- `suggestedActions` — Next steps (**prioritize these**)
- `warnings` — Risks (God Modules, blast radius)

---

## Layer 3 AI Features

**Optional advanced capabilities** (ADR-042-006, disabled by default):

| Feature | ENV Flag | Description |
|---------|----------|-------------|
| Smart Fuzzy Match | `KAIRO_LAYER3_SMART_MATCH=true` | Embedding-based symbol resolution |
| AST Impact | `KAIRO_LAYER3_SYMBOL_IMPACT=true` | Auto change impact detection |
| Code Generation | `KAIRO_LAYER3_CODE_GEN=true` | Pattern-aware generation |

---

## Internal Tools (Opt-in)

**ENV Flags:**
- `KAIRO_EXPOSE_INTERNAL_TOOLS=true` — Show internal tools in list
- `KAIRO_EXPOSE_FILE_TOOLS=true` — Show file-level utilities in list

**Recommendation:** Treat non-pillar tools as unstable and use the Five Pillars directly for best results.
