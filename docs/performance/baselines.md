# Performance Baselines (Representative)

This page captures **real benchmark outputs** from this repo to preserve Kairo’s performance “receipts”.

These numbers are **not a guarantee**: results depend on hardware, repo size, preset/config, and your MCP host timeout policy.

To reproduce, see the commands at the bottom.

---

## Engine benchmark (P2 diagnostics)

Source run:

- Report: `benchmarks/reports/full-report-1767430513134.md`
- Generated: 2026-01-03
- Scenario: `p2-m`

Selected results from that report:

| Metric | Value |
|---|---:|
| Cold start (500 files) | 24.334 ms |
| Incremental scan | 4.294 ms |
| Search latency p50 | 50.979 ms |
| Search latency p95 | 56.374 ms |
| RSS | 456.8 MB |
| Total storage | 463.8 MB |
| Recall@10 (scenario) | 100.0% |

Notes:

- “Cold start” here is the benchmark’s measured startup step (see `benchmarks/main.ts` for methodology).
- Quality metrics (recall) are scenario-dependent and meant as a regression guardrail, not an absolute score.

---

## Agent routing benchmark (cost vs reliability)

Source run:

- Report: `benchmarks/reports/agent-route-2026-01-27T05-18-02-427Z.md`
- Date: 2026-01-27
- Suite: `benchmarks/agent/suite.kairo5.json`

**Routed selection vs full baseline** (same suite, that run):

| Metric | Delta |
|---|---:|
| Pass@1 | +0.0pp |
| Total cost | -72.0% |
| Total wall time | +27.7% |
| Total tokens | +52.3% |

This is the core trade-off Kairo targets: **keep success-rate while lowering spend**, accepting some overhead from procedural execution and verification.

See: [Benchmark Report](/performance/benchmarks)

---

## Search accuracy microbenchmark (latency)

Source run:

- Report: `benchmarks/reports/adr-088-search-accuracy-1769184311937.json`

Selected results (that run):

| Metric | Value |
|---|---:|
| Latency avg | 29.33 ms |
| Latency p50 | 29.24 ms |
| Latency p95 | 31.64 ms |

---

## Reproduce (this repo)

Engine benchmark (writes a report under `benchmarks/reports/`):

```bash
node --import tsx benchmarks/main.ts --scenario p2-m
```

Agent route benchmark (writes markdown reports under `benchmarks/reports/`):

```bash
node benchmarks/agent/launch.mjs --provider codex --pipeline route \
  --suite benchmarks/agent/suite.kairo5.json --mode live \
  --mini gpt-5.1-codex-mini --full gpt-5.1-codex \
  --timeout-ms 600000 --kairo-budget low \
  --pricing benchmarks/agent/pricing.json \
  --attempts 2 --gate-files-min 5 --gate-category cli
```

See also: `benchmarks/README.md`

