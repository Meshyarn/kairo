# ADR-056: Token-Aware Dynamic Context Compression

**Status:** Implemented (0.4.3 baseline)
**Date:** 2026-01-11
**Related:** `docs/adr/ADR-043-adaptive-context-architecture.md`, `docs/adr/ADR-055-universal-parity-and-standardization.md`

## Why
The previous `maxChars`-based hard cut did not match actual model token usage (language/density differences). It also tended to truncate code/docs in the middle of sentences/blocks, which increased agent misreads and retry loops.

## What shipped
- **Token-first budgets:** Added `limits.maxTokens` support (Explore/Understand/Read). If provided together with `maxChars`, both constraints must be satisfied (the stricter limit wins). In 0.4.27+, the final response JSON envelope is also post-trimmed (ADR-080).
- **Elastic truncation:** When truncating by token budget, cut near block/paragraph/sentence boundaries (± window).
- **Distill (LOD downgrade):** When over budget, downgrade some full content to preview/skeleton (Explore), and compress skeletons into digests (Understand).
- **Standard degraded signal:** When compressed due to budget, return `degraded: true` + `reasons: ["budget_exceeded"]` + `compression` metadata.

## How to use
- Set budgets:
  - `explore({ ..., limits: { maxTokens: 8000 } })`
  - `understand({ ..., limits: { maxTokens: 6000 } })`
  - `read({ ..., limits: { maxTokens: 4000 } })`
- Server defaults (env vars):
  - `KAIRO_DEFAULT_MAX_TOKENS`
  - `KAIRO_EXPLORE_MAX_TOKENS`, `KAIRO_UNDERSTAND_MAX_TOKENS`, `KAIRO_READ_MAX_TOKENS`
- Choose the token estimator:
  - `KAIRO_TOKEN_ESTIMATOR=whitespace` (default) or `KAIRO_TOKEN_ESTIMATOR=chars`

## Output signals
- `degraded: true` with `budget_exceeded` in `reasons`/`degradedReasons`
- `compression`:
  - `mode: "truncate" | "distill"`
  - `maxTokens`, `estimatedTokens`, `usedChars`
  - (when available) `decisions` describing which items were downgraded

## Key code paths
- Token budget core: `src/orchestration/TokenBudget.ts`
- Explore: `src/orchestration/pillars/explore/ExplorePillar.ts`
- Understand: `src/orchestration/pillars/UnderstandPillar.ts`
- Read: `src/orchestration/pillars/ReadPillar.ts`
- Bench: `benchmarks/token-compression.ts`

