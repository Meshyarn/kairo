# ADR-082 (Summary): Simulate → Reason → Execute (StrategySearch + MCTS) for Change Reliability

**Status:** Implemented (0.4.28 baseline)  
**Date:** 2026-01-19  
**Related:** `docs/adr/ADR-041-integrity-audit-and-guardrails.md`, `docs/adr/ADR-054-cross-language-contract-awareness.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-083-language-agnostic-symbolic-guards.md`

## Why
`change` tends to rely on a single-shot plan/patch. If the first choice fails, the fix-loop cost (extra calls/retries) grows quickly.  
ADR-082 adds a **strategy search (strategySearch)** phase to `change` so it can safely compare multiple candidates (dry-run) and apply only the best candidate.

## What shipped
- **StrategySearch (R0~R2): Best-of-N**
  - Evaluate caller-provided candidates (`strategySearch.candidates`) via dry-run and cost/risk signals, then select the candidate with the highest reward
  - R1: up to 2, R2: up to 3 (hard cap per stage)
- **R3: MCTS/UCT (optional stage)**
  - Represent candidates as a tree (`children`) and expand via UCT within limited rollouts/timebox
  - Support seeded RNG (reproducibility)
- **Scoring hardening (Phase B)**
  - penalty based on cross-language contract impact (ADR-054)
  - high-severity penalty based on symbolic guards (ADR-083)
  - penalty for breaking-change signals (impact analyzer)
- **Batch candidate support**
  - include a batch path so candidates touching multiple files can still be evaluated via dry-run/contract/guards
- **Observability / decisionTrace**
  - Record selection rationale and degraded reasons via `strategy_search_start/candidate/selected/degraded/budget_exceeded/skipped/mcts` events
  - Expose per-candidate `rewardBreakdown` and the selected candidate’s `selectedRewardBreakdown`

## How to use (change input)
`strategySearch` is **opt-in** and runs only when provided.

- Basics
  - `mode: "off"` or `stage: "r0"` → skip strategySearch (R0)
  - `mode: "auto" | "force"` but no `candidates` → fall back to R0 + `reasoning_candidates_missing`
- Typical inputs (summary)
  - `strategySearch.mode`: `"off" | "auto" | "force"`
  - `strategySearch.stage`: `"r0" | "r1" | "r2" | "r3"`
  - `strategySearch.candidates[]`: `{ id, edits, targetFiles?, options?, children? }`
  - `strategySearch.mcts` (R3 only): `{ maxDepth, maxRollouts, exploration, seed? }`

## Reward function (current)
The base reward favors smaller/safer changes.

```txt
reward = 100
  - wFiles * touchedFiles
  - wDiff  * diffSize
  - wTok   * estimatedTokens
  - wRisk  * riskScore
  - wBreak * breakingChanges
  - wContract * contractPenalty
  - wGuardsHigh * guardsHigh;
```

## Defaults (performance-first)
- `timeboxMs=700`
- `maxCandidates=2` (R1 hard cap 2, R2 hard cap 3)
- `maxSimulationMs=350`, `maxImpactMs=250`
- `maxTouchedFiles=20`, `maxTokensEstimated=2400`
- weights: `files=1`, `diff=1`, `tokens=1`, `risk=2`, `breaking=3`, `contract=3`, `guardsHigh=2`
- R3 MCTS: `maxDepth=2`, `maxRollouts=5`, `exploration=1.4`, `seed?`

## Output signals
The `change` result includes `strategySearch`, with the following key fields:

- `strategySearch.selectedCandidateId`
- `strategySearch.selectedRewardBreakdown`
- `strategySearch.degradedReasons[]`
- `strategySearch.search` (R3 only): `{ algorithm, rollouts, maxDepth, exploration, seed?, evaluatedCount }`
- `strategySearch.candidates[]`:
  - `dryRunOk`, `reward`, `rewardBreakdown`
  - `touchedFiles`, `diffSize`, `estimatedTokens`
  - `riskLevel?`, `breakingChanges`
  - `contractBreaking`, `contractConsumers`
  - `guardsHigh`, `guardsDiagnostics`

## Key code paths
- StrategySearch core: `src/orchestration/pillars/change/ChangePillar.ts`
- Input types: `src/orchestration/IntentRouter.ts`
- Tool schema surface: `src/server/tools/ToolSpecRegistry.ts`
- Tool doc: `docs/agent/TOOL_REFERENCE.md`
