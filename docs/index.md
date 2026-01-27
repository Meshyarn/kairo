---
layout: home
title: Kairo
titleTemplate: false
hero:
  name: "Kairo"
  text: "Precision Context for Autonomous Agents"
  tagline: "Stop drowning your agents in noise. Kairo replaces massive file dumps with surgical evidence and safe execution contracts."
  image:
    src: /logo.svg
    alt: Kairo
  actions:
    - theme: brand
      text: "Get Started in 5 min"
      link: /quickstart/
    - theme: alt
      text: "View Concepts"
      link: /concepts/

features:
  - icon: ⚡️
    title: "Focused Precision"
    details: "Agents get exactly what they need—no more, no less. Token-efficient evidence packs (often reduces wasted context vs raw file dumps)."
    
  - icon: 🔍
    title: "Evidence-First"
    details: "Every answer includes verification data. Inline citations + deep artifacts for thorough audit."
    
  - icon: 🔒
    title: "Safe by Contract"
    details: "Plan → Review → Apply. Drift detection prevents accidental overwrites. Never auto-apply."
    
  - icon: ✈️
    title: "Offline Ready"
    details: "Runs locally with no external APIs. Works without Git. Perfect for air-gapped environments."
    
  - icon: 🎯
    title: "Two Tools"
    details: "task (find/analyze/edit) + manage (undo/redo/state). Minimal, predictable APIs."
    
  - icon: 🚀
    title: "Framework Agnostic"
    details: "Works with Claude, GPT, open models, custom agents. Any MCP host, any architecture."
---

<script setup>
import TerminalHero from './.vitepress/theme/components/TerminalHero.vue'
import BenchmarkComparison from './.vitepress/theme/components/BenchmarkComparison.vue'
</script>

<div style="margin: 0 auto; max-width: 1152px; padding: 0 24px;">

## Why Kairo?

<TerminalHero />

### The Real Problem

When agents query your codebase, they face a fundamental inefficiency:

<ComparisonCards />

**This is fundamental.** Precision doesn't mean cutting corners—it means delivering exactly what an agent needs to reason well.

---

## How Kairo Works

<FeatureGrid />

---

## Real-World Benchmark Results

<BenchmarkComparison />

---

## Historical Impact

<ImpactStats />

---

## Who Uses Kairo?

<UserSegments />

---

## Getting Started

**Minimal setup (3 lines of config):**

```json
{
  "command": "node",
  "args": ["/path/to/kairo/dist/index.js", "--root", "/path/to/repo"],
  "timeout": 300000,
  "env": {
    "KAIRO_MODE": "mcp",
    "KAIRO_PUBLIC_SURFACE": "compact",
    "KAIRO_LOG_TO_FILE": "true"
  }
}
```

**Then:**

<ReadingPath />

---

## For Different Roles

<RoleGuides />

---

</div>
