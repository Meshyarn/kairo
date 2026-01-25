# ADR-083 (Summary): Language-Agnostic Symbolic Guards (Portable Semantic Checks + Optional Solver)

**Status:** Implemented (0.4.27+ baseline)  
**Date:** 2026-01-18  
**Related:** `docs/adr/ADR-046-semantic-validation-layer.md`, `docs/adr/ADR-054-cross-language-contract-awareness.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-063-capability-diagnostics-and-provider-policy-integration.md`, `docs/adr/ADR-073-option-trace-standardization-decisiontrace-effectiveoptions.md`, `docs/adr/ADR-080-response-envelope-token-budget-explore-understand.md`

## Why
Kairo’s `change`/`write` can ensure that patches apply, but logical/contract/boundary-value errors can still slip through.  
In multi-repo/multi-lang environments, it is also difficult to require LSP/compiler-based validation as a default.

ADR-083 surfaces high-value error signals as first-class outputs in the `review` stage, following the principles of **language agnosticism (tree-sitter query packs) + bounded cost + soft-degrade**.

## What shipped
- **Enable `ReviewReport.semantic` (semantic surface):**
  - Merge name/link (existing `SemanticValidator`) + symbolic guards + contract-guard results into `ReviewReport.semantic.diagnostics`
  - Surface “why / which mode / how much” via `SemanticValidation.degradedReasons` + `SemanticValidation.stats`
- **Query-pack-based rule-only symbolic guards (v0):**
  - Detect index/null-deref/divide-by-zero patterns using captures from `src/queries/typescript/guards.scm`
  - Apply caps (`timeoutMs/maxDiagnostics/maxPaths/maxConstraints`); overflow degrades with `symbolic_budget_exceeded`
- **Contract guard promotion + cross-language integration (Phase C):**
  - Promote contract manifest diffs / consumer-impact signals into semantic diagnostics
  - Record breaking export changes as `CONTRACT_BREAKING_CHANGE` (severity=`error`)
  - Consumer scan is opt-in; cap overflow degrades with `contract_consumer_scan_capped`
- **Optional solver (Phase D, strict only):**
  - Wire the solver via capability `CAP_SYMBOLIC_SOLVE` + Rust provider (`RustSymbolicSolverProvider`)
  - Attempt the solver only in strict mode; if unavailable, degrade with `solver_unavailable` and stay rule-only
- **Explainability/observability:**
  - Record `symbolic_guards` events/skips in `decisionTrace` (`policy_disabled|unsupported|budget_exceeded`)
  - Add detailed metrics for solver comparison (`symbolic_solver.*`)

## How to enable
- Project-local config (recommended, gitignored): `.kairo/config/symbolic-guards.json` (base dir can be changed via `KAIRO_DIR`; legacy: `KAIRO_DIR/symbolic-guards.json`; for `.mcp`, set `KAIRO_ALLOW_LEGACY_MCP_DIR=true`)
  - `"enabled": true`
  - `"mode": "off" | "warn" | "block_high" | "strict"`
  - contract guard:
    - `"contractGuard": { "mode": "spec_only" | "spec_plus_consumer_scan", "consumerScan": { "enabled": true, "maxFiles": 200 } }`
  - To use the solver in strict mode: `"solver": { "enabled": true }` + `CAP_SYMBOLIC_SOLVE` required
- Env overrides (ops/debug):
  - `KAIRO_SYMBOLIC_GUARDS_ENABLED=true|false`
  - `KAIRO_SYMBOLIC_GUARDS_MODE=off|warn|block_high|strict`
  - `KAIRO_SYMBOLIC_GUARDS_TIMEOUT_MS=...`
  - `KAIRO_SYMBOLIC_GUARDS_MAX_DIAGNOSTICS=...`
  - `KAIRO_SYMBOLIC_GUARDS_MAX_PATHS=...`
  - `KAIRO_SYMBOLIC_GUARDS_MAX_CONSTRAINTS=...`
  - solver capability toggle: `KAIRO_RUST_CORE_ENABLED`, `KAIRO_RUST_SYMBOLIC_SOLVER_ENABLED`

Blocking policy is controlled only by the existing schema:
- apply can be blocked only when `reviewOptions.blockOn=["semantic"]` is set.

## Output signals
- `ReviewReport.semantic`:
  - `diagnostics[]` (severity: `"error" | "warning" | "info"`)
  - `degradedReasons[]` (e.g., `symbolic_query_missing`, `solver_unavailable`, `contract_manifest_stale`)
  - `stats.symbolic` (enabled/mode/queryUsed/solverUsed/constraintsBuilt/pathsExplored)
  - `stats.contractGuard` (mode/consumerScanUsed)
- contract diagnostics codes:
  - `CONTRACT_BREAKING_CHANGE` (`error`)
  - `CONTRACT_NON_BREAKING_CHANGE`/`CONTRACT_CHANGE` (`warning`)
  - `CONTRACT_FIELD_USAGE` (`warning`, only for `spec_plus_consumer_scan`)
- `decisionTrace.events`:
  - `{ area: "guardrails", code: "symbolic_guards", data: ... }`

## Key code paths
- Review surface + merge: `src/generation/review-report-builder.ts`
- Symbolic guards engine: `src/engine/validators/symbolic-guard-engine.ts`
- Symbolic config: `src/config/SymbolicGuardConfig.ts`
- Contract impact plumbing: `src/orchestration/pillars/change/ChangePillar.ts`, `src/engine/ImpactAnalyzer.ts`
- Solver capability/provider: `src/orchestration/capabilities/CapabilityIds.ts`, `src/orchestration/capabilities/providers/RustSymbolicSolverProvider.ts`
- Rust solver entrypoint (NAPI): `crates/core-rs/src/symbolic.rs`, `crates/core-rs/index.d.ts`
