# Performance

This section covers performance benchmarks, optimization strategies, and real-world validation of Kairo's routing and execution patterns.

## Key Topics

- **[Benchmark Report](/performance/benchmarks)** – Real-world comparison of routing vs. full-model strategies
- **[Performance & Reliability](/concepts/performance-and-reliability)** – Latency baselines, memory usage, and SLOs

## Quick Facts

- ✅ **Matched success rate** vs full baseline in a representative run (both 100% pass@1)
- 💰 **~72% cost reduction** with routed Mini+Kairo execution (same suite)
- ⏱️ **~28% wall-time overhead** (trade-off: cheaper, sometimes slower)

## What's Measured

| Metric | Why It Matters |
|--------|---|
| **Success Rate** | Prevents cascading failures in agent loops |
| **Cost per Task** | Enables cost-efficient scaling |
| **Execution Time** | Affects real-time feedback loops |
| **Token Usage** | Measures context efficiency |

## Next Steps

1. **Understand routing strategy:** [Agent Routing Strategy](/concepts/performance-and-reliability#agent-routing-strategy)
2. **Review benchmark details:** [Full Benchmark Report](/performance/benchmarks)
3. **Deploy to your environment:** [Deployment Scenarios](/guides/deployment-scenarios)
