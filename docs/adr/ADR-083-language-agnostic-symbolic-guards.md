# ADR-083 (Summary): Language-Agnostic Symbolic Guards (Portable Semantic Checks + Optional Solver)

**Status:** Implemented (0.4.27+ baseline)  
**Date:** 2026-01-18  
**Related:** `docs/adr/ADR-046-semantic-validation-layer.md`, `docs/adr/ADR-054-cross-language-contract-awareness.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-063-capability-diagnostics-and-provider-policy-integration.md`, `docs/adr/ADR-073-option-trace-standardization-decisiontrace-effectiveoptions.md`, `docs/adr/ADR-080-response-envelope-token-budget-explore-understand.md`

## Why
Kairo의 `change`/`write`는 “패치 적용 성공”을 보장할 수는 있지만, 논리/계약/경계값 오류는 쉽게 남는다.  
또한 multi-repo/multi-lang 환경에서는 LSP/컴파일러 기반 검증을 기본값으로 강제하기 어렵다.

ADR-083은 **언어 불가지론(tree-sitter query pack 기반) + bounded cost + soft-degrade** 원칙으로, 고가치 오류 신호를 `review` 단계에서 1st-class로 노출한다.

## What shipped
- **`ReviewReport.semantic` 활성화(semantic surface):**
  - name/link(기존 `SemanticValidator`) + symbolic guards + contract guard 결과를 `ReviewReport.semantic.diagnostics`로 병합
  - `SemanticValidation.degradedReasons` + `SemanticValidation.stats`로 “왜/어떤 모드로/얼마나”를 노출
- **Query-pack 기반 rule-only symbolic guards(v0):**
  - `src/queries/typescript/guards.scm` 캡처를 바탕으로 인덱스/널 deref/0 나눗셈 등 탐지
  - `timeoutMs/maxDiagnostics/maxPaths/maxConstraints` 상한 적용, 초과는 `symbolic_budget_exceeded`로 degrade
- **Contract guard 승격 + cross-language 결합(Phase C):**
  - contract manifest diff/consumer 영향 신호를 semantic diagnostics로 승격
  - breaking export 변경은 `CONTRACT_BREAKING_CHANGE`(severity=`error`)로 기록
  - consumer scan은 opt-in이며 cap 초과 시 `contract_consumer_scan_capped`로 degrade
- **Optional solver(Phase D, strict only):**
  - capability `CAP_SYMBOLIC_SOLVE` + Rust provider(`RustSymbolicSolverProvider`)로 solver 연결
  - strict 모드에서만 solver를 시도하고, 미가용 시 `solver_unavailable`로 degrade + rule-only로 유지
- **Explainability/observability:**
  - `decisionTrace`에 `symbolic_guards` 이벤트/skip 기록(`policy_disabled|unsupported|budget_exceeded`)
  - solver 비교용 상세 메트릭(`symbolic_solver.*`) 추가

## How to enable
- project-local config(권장, gitignore 대상): `.kairo/config/symbolic-guards.json` (base dir는 `KAIRO_DIR`로 변경 가능; legacy: `KAIRO_DIR/symbolic-guards.json`, `.mcp` 사용 시 `KAIRO_ALLOW_LEGACY_MCP_DIR=true`)
  - `"enabled": true`
  - `"mode": "off" | "warn" | "block_high" | "strict"`
  - contract guard:
    - `"contractGuard": { "mode": "spec_only" | "spec_plus_consumer_scan", "consumerScan": { "enabled": true, "maxFiles": 200 } }`
  - strict에서 solver를 쓰려면 `"solver": { "enabled": true }` + `CAP_SYMBOLIC_SOLVE` 필요
- env override(운영/디버그):
  - `KAIRO_SYMBOLIC_GUARDS_ENABLED=true|false`
  - `KAIRO_SYMBOLIC_GUARDS_MODE=off|warn|block_high|strict`
  - `KAIRO_SYMBOLIC_GUARDS_TIMEOUT_MS=...`
  - `KAIRO_SYMBOLIC_GUARDS_MAX_DIAGNOSTICS=...`
  - `KAIRO_SYMBOLIC_GUARDS_MAX_PATHS=...`
  - `KAIRO_SYMBOLIC_GUARDS_MAX_CONSTRAINTS=...`
  - solver capability toggle: `KAIRO_RUST_CORE_ENABLED`, `KAIRO_RUST_SYMBOLIC_SOLVER_ENABLED`

차단 정책은 기존 스키마로만 제어한다:
- `reviewOptions.blockOn=["semantic"]`가 설정된 경우에만 apply가 block될 수 있다.

## Output signals
- `ReviewReport.semantic`:
  - `diagnostics[]` (severity: `"error" | "warning" | "info"`)
  - `degradedReasons[]` (예: `symbolic_query_missing`, `solver_unavailable`, `contract_manifest_stale`)
  - `stats.symbolic` (enabled/mode/queryUsed/solverUsed/constraintsBuilt/pathsExplored)
  - `stats.contractGuard` (mode/consumerScanUsed)
- contract diagnostics codes:
  - `CONTRACT_BREAKING_CHANGE` (`error`)
  - `CONTRACT_NON_BREAKING_CHANGE`/`CONTRACT_CHANGE` (`warning`)
  - `CONTRACT_FIELD_USAGE` (`warning`, `spec_plus_consumer_scan`일 때만)
- `decisionTrace.events`:
  - `{ area: "guardrails", code: "symbolic_guards", data: ... }`

## Key code paths
- Review surface + merge: `src/generation/review-report-builder.ts`
- Symbolic guards engine: `src/engine/validators/symbolic-guard-engine.ts`
- Symbolic config: `src/config/SymbolicGuardConfig.ts`
- Contract impact plumbing: `src/orchestration/pillars/change/ChangePillar.ts`, `src/engine/ImpactAnalyzer.ts`
- Solver capability/provider: `src/orchestration/capabilities/CapabilityIds.ts`, `src/orchestration/capabilities/providers/RustSymbolicSolverProvider.ts`
- Rust solver entrypoint (NAPI): `crates/core-rs/src/symbolic.rs`, `crates/core-rs/index.d.ts`
