# ADR-084: MCP Autopilot & Preset Layer (Promptless/Agent-Agnostic Adoption)

**Status:** Implemented (0.5.x)  
**Date:** 2026-01-20  
**Related:** `docs/adr/ADR-040-five-pillars-toolset.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`, `docs/adr/ADR-077-mixed-workflow-resilience.md`, `docs/adr/ADR-078-cost-stabilization-and-adaptive-lod.md`, `docs/adr/ADR-080-response-envelope-token-budget-explore-understand.md`

## Summary

Kairo가 “강력하지만 무거운 MCP 서버”가 되는 문제(옵션 폭발/응답 폭발/host별 apply UX 불연속)를 해결하기 위해, **서버 내부에 Autopilot + Preset 레이어**를 도입한다.

핵심은 “에이전트가 옵션을 똑똑하게 고르는 것”이 아니라, **프롬프트 없이도(=promptless) 성공률이 높게 동작하는 MCP 서버**로 만드는 것이다.

## Decision (What changed)

### 1) Public surface를 2단으로 분리한다

- **Compact surface (기본 권장):** `task` + `manage`만 노출해 `list_tools` 토큰 풋프린트를 줄인다.
- **Pillars surface (고급/직접 제어):** `explore/understand/change/write/manage`를 그대로 유지한다.
- 전환: `KAIRO_PUBLIC_SURFACE=compact|pillars`

### 2) Router tool `task`를 추가한다

`task`는 “무슨 pillar/옵션을 써야 하는지”를 서버가 결정하도록 하는 **고수준 엔트리포인트**다.

- `mode`: `auto|ask|analyze|plan_change|apply_change|write|verify`
- `budget`: `lean|balanced|deep`
- 기본 출력은 항상 **summary-first**이며, 큰 결과는 **artifact**로 분리한다.
- 일부 모드는 단계적 롤아웃일 수 있다(예: `write`/`verify`).

### 3) Preset/Mode로 “env 스프롤”을 줄인다

- `KAIRO_MODE=mcp|dev|ci` (현재 기본값은 `mcp`)
- `KAIRO_PRESET=mcp-lean|mcp-balanced|mcp-deep` (mcp에서 기본값은 `mcp-lean`)
- `.kairo/config/mcp.json`으로 env 대신 프로젝트 로컬에서 preset/표면/핸드셰이크/타임박스 등을 고정한다.

### 4) Sloppy input을 성공으로 바꾼다 (canonicalization + compat)

호스트/에이전트가 자주 하는 alias/타입 실수는 가능한 범위에서 **정상화**하고, 모든 변환은 `contract.findings`로 기록한다.  
(`KAIRO_TOOL_SCHEMA_MODE=compat|strict`는 ADR-058 계약을 따른다.)

### 5) “짧은 응답 + artifact”를 전 pillar로 확장한다

ADR-080의 envelope budget/아티팩트 분리 패턴을 `change/write/manage`까지 확장해,
기본 응답이 대화 컨텍스트를 터뜨리지 않도록 한다.

### 6) Apply handshake(2-phase commit)를 서버가 강제한다

host UX가 달라도 안전모델이 깨지지 않게, **plan → apply**를 서버가 강제한다.

- plan 단계에서만 `applyToken`을 발급
- apply는 `draftId + applyToken` 없으면 `blocked`
- 기본 정책(권장): TTL/one-time/session-bound/drift-bound

### 7) verify는 “실행”이 아니라 “안전한 검증 + 실행 계획”이다

기본 경로에서 임의 shell command 실행을 하지 않는다.  
대신, 내부적으로 가능한 검증(가드레일/시맨틱 등) + 사용자가 실행할 추천 검증 계획을 제공한다.

### 8) schema는 on-demand로 꺼내본다

compact surface에서 고급 옵션이 필요하면:

- `manage({ command: "schema", tool: "<tool>", detail: "summary" | "full" })`

`detail:"full"`은 schema JSON을 artifact로 제공한다.

## Implementation notes (current repo)

- Tool filtering (compact vs pillars): `src/server/SmartContextServer.ts`
- `task` tool schema: `src/server/tools/ToolSpecRegistry.ts`
- `task` routing + envelope: `src/handlers/TaskHandlers.ts`
- Preset/Mode resolution: `src/orchestration/policy/McpModePresetRegistry.ts`
- Apply token enforcement: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`
- On-demand schema export: `src/handlers/ManageHandlers.ts`

## Testing / SLO gates

- Host compatibility smoke: `src/tests/integration/McpHostCompatibility.e2e.test.ts`
- Task SLO gate: `scripts/adr-084-task-slo-gate.mjs`
- Beta telemetry smoke: `scripts/adr-084-beta-log-smoke.mjs`
- Hardening smoke: `scripts/adr-084-hardening-smoke.mjs`
