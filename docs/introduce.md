# Introducing Kairo

**Kairo is a stdio MCP server designed around one core insight**: when agents query your codebase, precision matters more than comprehensiveness. Deliver exactly what the agent needs—no more, no less—and it will reason better, use fewer tokens, and succeed on the first try.

## The Problem It Solves

Most agent workflows follow a wasteful pattern:

1. Agent: "Show me everything matching this pattern"
2. Tool: *returns 500KB of context*
3. Agent: *uses 2% of it, wastes 98%*
4. Agent: *makes a mistake, retries*
5. Repeat

**This burns tokens, increases hallucinations, and kills productivity.**

Kairo flips this around:

1. Agent: "What code handles user authentication?" (structured query)
2. Kairo: *identifies 3 key files, extracts relevant snippets, adds evidence*
3. Agent: *has exactly what it needs, reasons accurately*
4. Success: *first try*

## Core Philosophy

### Four Non-Negotiables

1. **Compact by default**
   - Just 2 tools (`task`, `manage`) to learn
   - Boring, predictable APIs reduce hallucinations
   - Drill down to advanced options only when needed

2. **Evidence bundled**
   - Every answer includes verification data (inline + deep artifacts)
   - Agents can audit their own reasoning
   - Humans can verify decisions before acting

3. **Safe edits as contract**
   - Code changes: Plan → Review → Apply (never auto-apply)
   - Drift detection prevents overwrites
   - Two-phase handshake eliminates the "blind modification" problem

4. **Offline by default**
   - Lexical search: no index, instant
   - Optional local embeddings: runs on-device
   - Works without Git, GitHub, or external APIs
   - Perfect for air-gapped environments

## What This Means in Practice

| Traditional Tool | Kairo |
|---|---|
| "Find files with this regex" | "What code handles X?" (Kairo structures the answer) |
| Full file content | Relevant excerpts + evidence |
| Agent guesses what's important | Agent gets exactly what's important |
| High token overhead | 40-60% fewer tokens for same result |
| Multiple retries common | Higher first-attempt success |
| No audit trail | Evidence + verification bundled |
| Requires external APIs | Works offline, no dependencies |

## Who Is This For?

✅ **Agent framework developers** — You need reliable, predictable tool contracts  
✅ **MCP host integrators** — You need minimal configuration, maximum compatibility  
✅ **Enterprise teams** — You need offline capability, safety, and auditability  
✅ **Power users** — You work with large repos and need token efficiency  

❌ **Skip Kairo if** you only need simple text transforms or manual browsing

---

## Public Surfaces

Kairo exposes two surfaces (ADR-084). **Start with Compact.**

### Compact Surface (Recommended)

```
task          ← One entry point for most workflows
├─ ask        ← Retrieve information
├─ analyze    ← Understand code/structure
├─ plan       ← Plan a change (returns draftId)
└─ apply      ← Apply the change (with drift detection)

manage        ← State management, undo/redo, reindex
```

**Why Compact?**
- Single entry point minimizes decision overhead
- Tool routes internally to right pillar
- Stable APIs reduce agent confusion
- Works across frameworks (Claude, GPT, custom agents)

### Pillars Surface (Advanced)

```
explore       ← Find code by pattern
understand    ← Analyze structure/dependencies
change        ← Plan modifications
write         ← Create new code
manage        ← State/history management
```

**When to use Pillars:**
- You need granular per-operation control
- You have advanced profiling/tuning needs
- You're building a custom framework

---

## How to Get Started

### 3-Minute Overview

1. **[Why Kairo](/introduce)** — 5 min read on core philosophy
2. **[Installation](/quickstart/npm-install-and-setup)** — Get Kairo running
3. **[First Call](/quickstart/first-calls)** — Copy-paste working example

### Deeper Dive

1. **[Concepts](/concepts/)** — Understand Evidence Packs, Safe Writes, Offline Baseline
2. **[Guides](/guides/)** — Real workflows (getting started, ops, performance tuning)
3. **[Reference](/reference/)** — Tool contracts, configuration, all options

### For Framework Builders

1. **[Agent Framework Integration](/guides/agent-framework-integration)** — Patterns for your agent
2. **[Tool Reference](/agent/TOOL_REFERENCE)** — Complete contract specifications
3. **[Deployment Scenarios](/guides/deployment-scenarios)** — Real-world configs for different environments

---

## Quick Decision Matrix

| Your Situation | Solution |
|---|---|
| "I want to connect Claude to my repo" | [Quickstart](/quickstart/) |
| "I'm building an agent framework" | [Agent Integration](/guides/agent-framework-integration) |
| "I need to understand how Kairo works" | [Concepts](/concepts/) |
| "I need exact tool specifications" | [Tool Reference](/agent/TOOL_REFERENCE) |
| "I'm tuning for performance/cost" | [Performance & Reliability](/concepts/performance-and-reliability) |
| "I'm deploying to production/air-gap" | [Deployment Scenarios](/guides/deployment-scenarios) |

---

## Design Rationale

Read the [Architecture (ADRs)](/adr/) for deep dives into:
- ADR-084: Compact vs. Pillars surface design
- ADR-086: Safe writes (Plan-Apply contract)
- ADR-089: Raw content sources for `write`/`change` (avoid quote/escape breakage)
- ADR-087: Evidence Packs (bundled verification data)
- ADR-040: Five Pillars architecture

---

## One More Thing

**Kairo is built on the principle that agent success depends on precise tool design, not chatty interfaces.**

Every feature, every API, every decision is aimed at one goal: *give agents exactly the information they need to reason accurately on the first try.*

Everything else is noise.
