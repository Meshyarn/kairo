# Performance & Reliability

This document distills real benchmark data and test coverage into actionable insights for your environment.

**Audience:** Anyone evaluating whether Kairo can meet your performance requirements.

---

## Agent Routing Strategy

### The Challenge

When integrating AI agents into your workflow, you face a fundamental trade-off: use a powerful (expensive) model everywhere, or a cheaper model that may miss edge cases.

### The Solution: Intelligent Routing

Kairo enables a **hybrid strategy**: default to smaller, cost-effective models while routing complex scenarios to state-of-the-art models. This approach combines the best of both worlds.

#### Real-World Results (Representative Run)

A benchmark comparing pure full-model execution vs. routed strategy (single run, model/pricing snapshot specific):

| Metric | Full Baseline (GPT-5.1 Codex) | Routed (Mini baseline + Mini+Kairo) | Delta |
|--------|--------|--------|--------|
| **Pass@1** | 100% | 100% | +0.0pp |
| **Cost (8-case suite run)** | $2.49 | $0.70 | -72.0% 💰 |
| **Execution time (wall)** | 20.0 min | 25.6 min | +27.7% |
| **Total tokens** | 4.20M | 6.39M | +52.3% |

**Interpretation:**
- 💰 Routing can materially reduce spend even when pass rates are similar.
- ⏱️ The wall-time and token overhead is expected from structured execution / verification; whether it’s acceptable depends on your workload.
- 📌 Some procedural tasks (flags, multi-file consistency) can be competitive with a full-model baseline, but results vary across repos and prompts.

#### Why This Works

1. **Procedural Verification**: Kairo enforces validation steps (drift checks, file verification, syntax validation) that catch errors before they propagate.
2. **Cost Efficiency**: Small models are typically much cheaper per token. Many procedural tasks can run on Mini baseline, while a smaller subset benefits from structured execution (Mini + Kairo) or (optionally) a full model.
3. **Predictability**: Structured workflows are more predictable than raw LLM output, even from powerful models.

#### When to Use Routing

| Scenario | Recommendation |
|----------|---|
| Cost-sensitive operations | ✅ Use routing (default Mini baseline; route selected cases to Mini+Kairo) |
| Safety-critical tasks | ✅ Use routing (verification steps protect against errors) |
| High-throughput agent loops | ✅ Use routing (distribute load efficiently) |
| Simple, well-defined tasks | ⚠️ Consider pure Mini (routing can be unnecessary overhead) |
| Prototype/exploration phase | ⚠️ Consider pure Full (faster iteration), then add routing for scale |

---

## Benchmark Data (Real Systems)

### Latency Baselines

Tested on a 2,500-file TypeScript + Python monorepo (16 GB source, ~1M symbols):

#### Lexical Search (Tantivy)

| Scenario | p50 | p95 | p99 |
|----------|-----|-----|-----|
| Cached (hot) | 8ms | 15ms | 35ms |
| Disk load (cold) | 45ms | 120ms | 280ms |
| Complex query (e.g., "find all imports") | 60ms | 200ms | 450ms |

**What this means:**
- Typical user query: 8-15ms (feels instant)
- First query of session: 45-120ms (acceptable)
- Heavy analysis queries: under 500ms (still responsive)

#### Vector Search (GraphRAG + e5-small model)

| Scenario | p50 | p95 | p99 |
|----------|-----|-----|-----|
| Cached embedding | 12ms | 25ms | 50ms |
| On-demand embedding (first time) | 150ms | 400ms | 800ms |
| Cross-file semantic links | 85ms | 220ms | 600ms |

**What this means:**
- Semantic queries after warmup: 12-25ms
- First semantic query in session: 150-400ms (one-time cost)
- Finding related code across files: very fast after initial warmup

#### Composite (Plan → Explore → Understand → Apply)

| Operation | Time | Notes |
|-----------|------|-------|
| `explore` (list files) | 10-50ms | Cached if recently indexed |
| `understand` (symbol analysis) | 100-500ms | Depends on depth/budget |
| `plan_change` (draft generation) | 200-800ms | Token-limited (not I/O bound) |
| `apply_change` (safe apply) | 50-300ms | Drift check + verification |

**Full Writer's Flow (lean budget):** ~400-800ms end-to-end

---

### Memory Usage

Same 2,500-file repo:

| Component | Baseline | Peak (deep query) | Peak (reindex) |
|-----------|----------|------------------|----------------|
| Lexical index | 145 MB | 160 MB | 180 MB |
| Vector embeddings | 220 MB | 240 MB | 260 MB |
| AST caches | 85 MB | 250 MB | 280 MB |
| Node.js runtime | 120 MB | 150 MB | 200 MB |
| **Total** | **570 MB** | **800 MB** | **920 MB** |

**What this means:**
- Typical allocation: 600-700 MB
- `NODE_OPTIONS="--max-old-space-size=4096"` is safe for repos up to 10,000 files
- For very large repos (50,000+ files), use 8192 MB

---

## Test Coverage & Reliability

### Smoke Tests (Quick validation)

Run before each deployment:

```bash
npm run smoke:mcp-mock-client        # Basic I/O
npm run smoke:adr-088-change-write-minimal-apply   # Write flow
npm run smoke:adr-088-compact-guidance              # Guidance completeness
```

**What passes:**
- MCP protocol compliance ✅
- Stdio communication (100 concurrent messages) ✅
- Safe apply (drift detection, atomic transactions) ✅
- Error guidance (every error has actionable `guidance[]`) ✅

**Expected runtime:** < 30 seconds total

### Performance Tests (SLO gates)

Run on CI to catch regressions:

```bash
npm run benchmark:adr-084-task-slo      # Latency gates (p95 < 500ms)
npm run benchmark:adr-085-search-slo    # Search accuracy (recall > 95%)
npm run benchmark:adr-088-search-accuracy  # Symbol resolution (> 98%)
```

**SLOs we maintain:**

| SLO | Target | Actual (p95) | Status |
|-----|--------|------------|--------|
| Task latency | < 500ms | 380ms | ✅ Pass |
| Search recall | > 95% | 97.2% | ✅ Pass |
| Symbol accuracy | > 98% | 99.1% | ✅ Pass |
| Drift detection | 100% | 100% | ✅ Pass |
| Apply success rate | > 99.5% | 99.8% | ✅ Pass |

---

## Bottleneck Analysis

### Where time is spent (typical workflow)

```
Explore request (100ms total)
├─ Query intent detection     5ms (fast)
├─ Lexical search            40ms (disk I/O if cold)
├─ Result ranking            15ms (cached mostly)
└─ Response serialization    40ms (JSON for 50 results)

Understand request (300ms total)
├─ AST parsing               120ms (per-file; parallelized)
├─ Symbol extraction         80ms (tree traversal)
├─ Semantic linking          60ms (embedding queries if deep)
└─ Response assembly         40ms

Apply request (150ms total)
├─ Drift check               30ms (file hashes)
├─ Execution (edit/patch)    80ms (actual I/O)
├─ Verification             20ms (re-read + validate)
└─ Serialize response        20ms (results)
```

### Optimization opportunities

**Bottleneck: Cold disk access** → Solution: Pre-warm indexes via `manage({ command: "init" })`

**Bottleneck: AST parsing** → Solution: Use lean budget for initial queries; deep budget only when needed

**Bottleneck: Large result sets** → Solution: Limit `KAIRO_MAX_RESULTS` (default 25; most queries don't need > 10)

**Bottleneck: Embedding computation** → Solution: Enable vector index caching; reuse sessions

---

## Expected Performance by Environment

### Development (Local machine)

**Configuration:**
```bash
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=hash
export NODE_OPTIONS="--max-old-space-size=4096"
```

**Expected metrics:**
- Startup: < 1 second
- First query: 50-200ms
- Subsequent queries: 10-50ms
- Memory: 300-500 MB

**Good for:** Fast iteration, quick tests, CI pipelines

---

### Team CI/CD (Shared container)

**Configuration:**
```bash
export KAIRO_BUDGET=balanced
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export NODE_OPTIONS="--max-old-space-size=6144"
```

**Expected metrics:**
- Init time: 30-90 seconds (first time only; then cached)
- Query latency: 20-100ms (p95)
- Memory: 600-800 MB
- Cache hit rate: 85-95% (after first 5-10 queries)

**Good for:** Reproducible results, caching across builds, team consistency

---

### Production Agent (High throughput)

**Configuration:**
```bash
export KAIRO_BUDGET=deep
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX_REBUILD=manual
export NODE_OPTIONS="--max-old-space-size=8192"
```

**Expected metrics:**
- Setup overhead: One-time 2-5 minutes (reindex)
- Query latency: 50-300ms (p95)
- Throughput: 50-100 concurrent sessions
- Memory: 800 MB - 2 GB

**Good for:** Agent loops, deep analysis, multi-user scenarios

---

### Air-gapped / Edge (Minimal deps)

**Configuration:**
```bash
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_ALLOW_STDOUT_LOGS=false
export NODE_OPTIONS="--max-old-space-size=2048"
```

**Expected metrics:**
- Startup: < 500ms
- Lexical-only queries: 10-40ms (p95)
- Memory: 250-400 MB
- Dependencies: Node.js only (no model downloads)

**Good for:** Restricted environments, quick deployments, offline-first

---

## Degradation & Error Recovery

### Graceful degradation

When a feature is unavailable, Kairo automatically falls back:

```json
{
  "requestedFeatures": ["graphRAG", "caching", "vectorIndex"],
  "availableFeatures": ["lexicalSearch", "caching"],
  "degradedReasons": [
    "graphRAG unavailable (model not loaded)",
    "vectorIndex unavailable (embeddings disabled)"
  ],
  "recommendations": [
    "Enable KAIRO_EMBEDDING_PROVIDER=local for vector search",
    "See: [Search & Embeddings Guide](/guides/search-and-embeddings)"
  ]
}
```

**Result:** Queries still work; just less powerful.

### Error rates (real production data)

| Error class | Rate | Recovery |
|------------|------|----------|
| Parse errors | 0.2% | Automatic (fallback to JSON) |
| Timeout errors | 0.1% | User retry (with exponential backoff) |
| Drift collisions | 0.01% | Automatic (rebase + retry) |
| Memory OOM | < 0.001% | Restart process |

**Bottom line:** 99.7% of requests succeed without user intervention.

---

## How to Validate in Your Environment

### 1. Run benchmarks locally

```bash
npm run benchmark:lod-comp        # Compare lean/balanced/deep
npm run benchmark:adr-088-env-matrix  # Test your specific config
```

### 2. Warm up indexes

```bash
manage({ command: "init" })
manage({ command: "reindex" })
```

Wait for completion, then measure:

```bash
time task({ request: "List all functions", mode: "auto" })
```

### 3. Monitor during use

```bash
# Terminal 1: watch logs
tail -f .kairo/kairo.log | grep -E "latency|memory|cache_hit"

# Terminal 2: run your workload
# (Your agent loop or user queries)

# Terminal 3: check stats
manage({ command: "status" })
```

---

## Performance Tuning Checklist

- [ ] Running lean budget initially? (Optimize later if needed)
- [ ] Indexes initialized? (`manage({ command: "init" })`)
- [ ] Embeddings warmed up? (First query pre-warms; subsequent are 10-50ms)
- [ ] Logs redirected to file? (`KAIRO_LOG_TO_FILE=true`, `KAIRO_ALLOW_STDOUT_LOGS=false`)
- [ ] Heap size appropriate for repo size? (Baseline 4096, increase to 8192 for large)
- [ ] Result limit set? (`KAIRO_MAX_RESULTS=25` or lower)
- [ ] Session reuse enabled? (Keep `sessionId` across calls to cache results)
- [ ] Monitoring active? (Tail logs or use `manage({ command: "status" })`)

---

## Next steps

1. **Deploy to your environment:** [Deployment Scenarios](/guides/deployment-scenarios)
2. **Troubleshoot performance:** [Ops Runbook](/guides/ops-runbook)
3. **Understand trade-offs:** [Configuration Reference](/reference/configuration/budgets)
