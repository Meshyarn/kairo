# ADR-082 (Summary): Simulate → Reason → Execute (StrategySearch + MCTS) for Change Reliability

**Status:** Implemented (0.4.28 baseline)  
**Date:** 2026-01-19  
**Related:** `docs/adr/ADR-041-integrity-audit-and-guardrails.md`, `docs/adr/ADR-054-cross-language-contract-awareness.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-083-language-agnostic-symbolic-guards.md`

## Why
`change`는 single-shot(한 번 만든 계획/패치) 의존도가 높아서, 첫 선택이 실패하면 fix-loop(추가 호출/재시도) 비용이 커진다.  
ADR-082는 `change`에 **전략 탐색(strategySearch)** 단계를 넣어 “여러 후보를 안전하게(dry-run) 비교하고, 가장 좋은 후보 1개만 적용”하도록 한다.

## What shipped
- **StrategySearch (R0~R2): Best-of-N**
  - 호출자가 제공한 후보(`constraints.strategySearch.candidates`)를 dry-run + 비용/리스크 신호로 평가하고 reward가 가장 큰 후보를 선택
  - R1: 최대 2개, R2: 최대 3개 (stage별 hard cap)
- **R3: MCTS/UCT (optional stage)**
  - 후보를 트리로 표현(`children`)하고, 제한된 rollouts/timebox 내 UCT로 확장 탐색
  - seed RNG 지원(재현성)
- **스코어링 강화 (Phase B)**
  - cross-lang contract 영향(ADR-054) 기반 penalty
  - symbolic guards(ADR-083) 기반 high severity penalty
  - breaking change 신호(impact analyzer) penalty
- **Batch candidate 지원**
  - 후보가 여러 파일을 건드릴 때도 dry-run/contract/guards 평가가 가능하도록 batch 경로를 포함
- **Observability / decisionTrace**
  - `strategy_search_start/candidate/selected/degraded/budget_exceeded/skipped/mcts` 이벤트로 선택 근거와 degrade 사유를 남김
  - 후보별 `rewardBreakdown`, 선택된 후보의 `selectedRewardBreakdown` 제공

## How to use (Change constraints)
`strategySearch`는 기본적으로 **opt-in**이며, `constraints.strategySearch`가 주어졌을 때만 동작한다.

- 기본 동작
  - `mode: "off"` 또는 `stage: "r0"` → strategySearch 스킵(R0)
  - `mode: "auto" | "force"`인데 `candidates`가 없으면 → R0 폴백 + `reasoning_candidates_missing`
- 대표 입력(요약)
  - `constraints.strategySearch.mode`: `"off" | "auto" | "force"`
  - `constraints.strategySearch.stage`: `"r0" | "r1" | "r2" | "r3"`
  - `constraints.strategySearch.candidates[]`: `{ id, edits, targetFiles?, options?, children? }`
  - `constraints.strategySearch.mcts` (R3 only): `{ maxDepth, maxRollouts, exploration, seed? }`

## Reward function (current)
기본 reward는 “작고/안전한 변경”을 선호한다.

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
`change` 결과에 `strategySearch`가 포함되며, 주요 필드는 다음과 같다:

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
