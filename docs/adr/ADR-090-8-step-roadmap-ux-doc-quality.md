# ADR-090: 8-Step Roadmap (Adoption/UX/Docs Drift → Reliability)

**Status:** Implemented  
**Date:** 2026-02-03  
**Scope:** `kairo` repo (code + docs + scripts)  
**Related:** `docs/adr/ADR-053-C-managed-config-bootstrap.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`, `docs/adr/ADR-081-graphrag-hybrid-cluster-retrieval.md`, `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md`, `docs/adr/ADR-085-rust-native-search-core-tantivy.md`, `docs/adr/ADR-086-task-compact-change-write-verify.md`, `docs/adr/ADR-089-raw-content-sources-for-change-write.md`

ADR-090 is a fixed-order roadmap executed as **WP1–WP8** to make Kairo easier to adopt, harder to misconfigure, and less likely to drift (docs/contracts) while improving retrieval reliability.

This ADR is intentionally practical: each work package ships user-visible improvements (CLI/help/templates), drift guards, and/or safer recovery paths.

## Decision (principles)

- **ROI order:** ship short, high-impact UX/drift guards first.
- **Additive tool schema:** prefer additive changes and keep `compat` behavior (ADR-058).
- **Opt-in risky execution:** anything that runs arbitrary commands stays **off by default** and uses an allowlist.
- **No host home edits:** `manage init` generates repo-local templates; it does not patch `~/.config/...` automatically.

## Implemented work packages (summary)

### WP1 — `manage init` host snippet templates

Problem: host MCP wiring is error-prone and inconsistent.  
Outcome: `manage init` can generate repo-local host templates under `.kairo/config/hosts/` (copy/paste into the host).

- Targets added: `host_snippets`, `host_codex`, `host_claude_cli`, `host_gemini_cli`
- Docs: `docs/guides/promptless-integration.md` (+ `/ko/` equivalent)

### WP2 — CLI help/version and clearer startup errors

Problem: onboarding relied on docs; errors were harder to self-serve.  
Outcome: `--help/-h` and `--version/-v` supported; startup errors hint to `--help`.

- Entry: `src/index.ts`

### WP3 — docs drift guard expansion

Problem: docs easily drifted from the real tool schema/env/commands.  
Outcome: `scripts/validate-docs.mjs` expanded to statically validate:

- manage command references (e.g. `manage({ command: "status" })`) against tool enums
- task modes/budgets references
- `KAIRO_*` env mentions against code references

### WP4 — GraphRAG `doc_first` seeding

Problem: selecting `doc_first` immediately degraded to `lexical_default`.  
Outcome: `doc_first` now seeds clusters using document retrieval and only degrades when no eligible seeds exist.

- Code: `src/orchestration/cluster/GraphRagClusterService.ts`, `src/config/GraphRagConfig.ts`

### WP5 — degradedReasons-driven recovery guidance

Problem: failures were reported but not consistently actionable.  
Outcome: degraded reasons map to concrete `guidance.nextCalls` suggestions (e.g. `manage doctor`, `manage status`, `task plan_change`).

- Code: `src/orchestration/DegradedReasonMapper.ts`, `src/handlers/task/TaskGuidanceUtils.ts`

### WP6 — opt-in `verifyExec` (safe command allowlist)

Problem: “verify” often needed a minimal build/lint step, but arbitrary exec is risky.  
Outcome: add `verifyExec` to `task.verify`, gated by:

- Env: `KAIRO_VERIFY_EXEC_ENABLED=true`
- Config allowlist: `.kairo/config/verify-exec.json`

Implementation:

- `src/orchestration/verification/VerifyExecConfig.ts`
- `src/orchestration/verification/VerifyExecRunner.ts`

Docs:

- `docs/reference/configuration/change-write-and-drift.md` (+ `/ko/` equivalent)
- `docs/agent/TOOL_REFERENCE.md` (+ `/ko/` equivalent)

### WP7 — ADR dashboard generator

Problem: ADR/archive/curated status was hard to track and easy to stale.  
Outcome: `scripts/generate-adr-dashboard.mjs` generates:

- `docs/reference/adr-dashboard.md`
- `docs/reference/adr-dashboard.json`

### WP8 — native-core candidate PoC scaffold (file scan fallback)

Problem: scan-based fallbacks can become the CPU hotspot on large repos.  
Outcome: introduce a capability boundary for scan fallback with JS default + opt-in native hook:

- Capability: `CAP_FILE_SCAN`
- Flag: `KAIRO_RUST_FILE_SCAN_ENABLED` (default off)
- Native hook (future): `@kairo/core-rs` may export `fileScan(...)`; if missing, JS provider remains active.
- SLO gate: `scripts/adr-090-native-scan-slo-gate.mjs` (`npm run benchmark:adr-090-native-scan-slo`)

Implementation:

- Capability: `src/orchestration/capabilities/FileScan.ts`, `src/orchestration/capabilities/CapabilityIds.ts`, `src/orchestration/capabilities/DefaultEngineRegistry.ts`
- Providers: `src/orchestration/capabilities/providers/JsFileScanProvider.ts`, `src/orchestration/capabilities/providers/RustFileScanProvider.ts`
- Search wiring: `src/engine/Search.ts`

## Consequences / impact

- **Faster onboarding:** `manage init` host templates + `--help/--version`.
- **Lower support cost:** docs drift is caught by `validate:docs` before release.
- **Better doc-centric retrieval:** GraphRAG `doc_first` stops degrading by default.
- **More self-healing flows:** degraded reasons produce concrete next calls.
- **Safer verification:** `verifyExec` is opt-in + allowlisted + repo-root constrained.
- **Clearer architecture visibility:** ADR dashboard keeps “what exists” discoverable.
- **Native path without lock-in:** scan fallback is ready for a native implementation without changing call sites again.

## Follow-ups (explicitly deferred)

- Implement the actual native `fileScan(...)` binding in `@kairo/core-rs` (this ADR only adds the scaffold + gating + SLO harness).
