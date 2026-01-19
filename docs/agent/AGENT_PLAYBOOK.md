# Agent Playbook

> **Five Pillars** — intent-based codebase interaction

---

## The Five Pillars

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

// Step 2: Plan (dry-run)
change({ intent: "Add domain whitelist", options: { dryRun: true } })

// Step 3: Verify diff + impact

// Step 4: Apply
change({ intent: "Add domain whitelist" })
```

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

// Step 2: Plan first (dry-run)
const plan = await change({ intent: "Tighten JWT validation", targetFiles: ["src/auth/jwt.ts"], options: { dryRun: true }, sessionId })

// Step 3: Apply
await change({ ...plan, options: { dryRun: false }, sessionId })
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
