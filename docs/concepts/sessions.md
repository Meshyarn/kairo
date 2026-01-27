# Sessions & Multi-step Workflows

Kairo supports long-running "writer-style" flows where multiple calls build on shared context.

## What a session is

A `sessionId` lets Kairo:

- correlate tool calls,
- reuse intermediate artifacts,
- make multi-step change/write flows clearer (drafts, warnings, next calls).

## When to use sessions

Use sessions when you expect:

- multi-step investigation (explore → understand → plan),
- iterative planning (refining a draft),
- safe write/apply/verify loops.

## Example: Full Writer's Flow

```typescript
// Step 1: Research (optional)
// Start a new session to correlate all subsequent calls
// research: { sketch: true } performs lightweight concept extraction
const exploreRes = await task({
  request: "Find authentication module structure",
  mode: "ask",
  sessionId: "new"  // Start a new session
});

const sessionId = exploreRes.sessionId;  // Persist for next calls

// Step 2: Deep analysis
// Reuse session artifacts (same embeddings/clusters as step 1)
// vibe.extract=true: identify key abstractions
// analysis.clusters=true: semantically group related code (requires GraphRAG)
const analyzeRes = await task({
  request: "Explain auth flow and identify security concerns",
  mode: "analyze",
  budget: "balanced",
  sessionId  // Reuse session
});

// Step 3: Plan changes
// Still using same session → faster because embeddings are cached
// safety: "plan" means compute the change without applying yet
const planRes = await task({
  request: "Plan: Strengthen JWT validation in auth/jwt.ts",
  mode: "plan_change",
  targetFiles: ["src/auth/jwt.ts"],
  sessionId
});

// Inspect the plan before applying
console.log("Draft ID:", planRes.draftId);
// workflowWarnings surface missing prerequisites (e.g., "GraphRAG required")
console.log("Warnings:", planRes.workflowWarnings);

// Step 4: Apply changes
// safety: "apply" executes the plan using draftId + applyToken
// This is gated: token is one-time, so apply must be deliberate
const applyRes = await task({
  mode: "apply_change",
  draftId: planRes.draftId,
  applyToken: planRes.applyToken,
  sessionId
});

console.log("Applied:", applyRes.result.changedFiles);
```


**Key points:**

- Start with `sessionId: "new"` to begin a session
- Persist `sessionId` across all subsequent calls
- Reused artifacts (embeddings, clusters) make the flow faster
- `workflowWarnings` surface missing prerequisites (e.g., GraphRAG config)
- `guidance.nextCalls` provides template calls for the next step

## Framework tips

- Persist `sessionId` across the user's workflow in your agent framework.
- If Kairo returns `guidance.nextCalls`, execute them verbatim; they include the correct ids/tokens.

For the compact surface patterns, see:

- [Agent Playbook](/agent/AGENT_PLAYBOOK)


