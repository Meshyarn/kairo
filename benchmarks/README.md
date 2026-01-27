# 🎯 Benchmark Suite (Curated)

This folder has been trimmed to make **core benchmarks** easy to run while keeping ADR/experimental scripts available (but separated).
The reproducibility goals and recommended runs are documented in `docs/performance/benchmarks.md` (and `docs/ko/performance/benchmarks.md`).

## ✅ Core (maintained)

### 1) Engine benchmark (P2 diagnostics)

```bash
node --import tsx benchmarks/main.ts
```

Scenarios live in `benchmarks/scenarios/`:

```bash
node --import tsx benchmarks/main.ts --scenario p2-s
node --import tsx benchmarks/main.ts --scenario p2-m
node --import tsx benchmarks/main.ts --scenario p2-l
```

Reports are saved under `benchmarks/reports/`.

### 2) Agent benchmark suite (automation-first)

```bash
node --import tsx benchmarks/agent/run.ts \
  --suite benchmarks/agent/suite.kairo5.json \
  --mode mock
```

For live runs, set `KAIRO_AGENT_MODEL_CMD` and see `benchmarks/agent/README.md`.

For route/cascade runs, prefer the launcher wrapper:

```bash
node benchmarks/agent/launch.mjs --provider codex --pipeline route \
  --suite benchmarks/agent/suite.kairo5.json --mode live \
  --mini gpt-5.1-codex-mini --full gpt-5.1-codex \
  --timeout-ms 600000 --kairo-budget low \
  --pricing benchmarks/agent/pricing.json \
  --attempts 2 --gate-files-min 5 --gate-category cli
```

(Local helper scripts under `benchmarks/scripts/` were intentionally removed to avoid accidental secret leakage.)

---

## 📌 ADR benchmarks (organized)

ADR/phase benchmarks are now grouped in `benchmarks/adr/`:

```bash
node --import tsx benchmarks/adr/handler-overhead.ts
node --import tsx benchmarks/adr/phase2-performance.ts
node --import tsx benchmarks/adr/pillar-modularization.ts
node --import tsx benchmarks/adr/token-compression.ts
node --import tsx benchmarks/adr/lod-comparison.ts
node --import tsx benchmarks/adr/lod-promotion-flow.ts
node --import tsx benchmarks/adr/strategy-search-phase-b.ts
node --import tsx benchmarks/adr/strategy-search-phase-c.ts
node --import tsx benchmarks/adr/writers-flow-adr-051.ts
node --import tsx benchmarks/adr/symbol-search-scalability.ts
```

(`npm run benchmark:*` scripts have been updated to the new paths.)

---

## 🧪 Experiments / legacy

- `benchmarks/experiments/`: ad-hoc or exploratory scripts (kept for reference).
- `benchmarks/legacy/`: older JS runners / v2 artifacts.

---

## 📦 Outputs

- `benchmarks/runs/`: raw run artifacts
- `benchmarks/reports/`: rendered reports

These are generated outputs; feel free to prune or archive them as needed.
