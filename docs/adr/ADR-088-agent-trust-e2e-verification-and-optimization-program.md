# ADR-088: Agent Trust E2E Verification & Optimization Program (MCP stdio)

**Status:** Implemented  
**Date:** 2026-01-24  
**Related:** `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md`, `docs/adr/ADR-086-task-compact-change-write-verify.md`, `docs/adr/ADR-087-task-adaptive-lod-and-evidence-pack.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`, `docs/adr/ADR-064-fileversion-handshake-read-apply.md`, `docs/adr/ADR-067-observability-baseline-bench-accuracy-min-metrics-otel.md`

## Summary

Kairo’s success criteria is not “feature completeness”, but **agent trust**: real agents should reliably choose to call the MCP server (often), get useful answers, and close loops quickly (especially **plan → apply → verify**), without host-specific friction.

ADR-088 defines and implements an E2E verification + optimization program for the real production path:

- `KAIRO_MODE=mcp`
- `publicSurface=compact`
- **stdio MCP transport**

The program is designed to detect regressions early (CI gates) and to make “agent trust” measurable via actionable response contracts (`guidance.nextCalls`) and stable degraded-reason signaling.

## Scope

In-scope:
- Compact surface behavior (`task`/`manage`) as seen by agents and MCP hosts.
- Apply handshake / plan→apply closures (including recovery paths).
- Stdio protocol integrity (no stdout pollution).
- Search quality and index health behaviors that affect downstream agent decisions.
- Long-run stability (latency/memory/cpu) as “trust multipliers”.

Out-of-scope:
- Full-blown, host-specific prompt engineering (the baseline is promptless).
- External network dependencies (offline-first by default).

## Trust invariants (what must hold)

- **Actionability:** `guidance.nextCalls` (compact) must be executable as-is (`tool ∈ {task, manage}`).
- **2-phase apply:** apply requires a plan-issued `applyToken` when `applyHandshake.required=true`.
- **Drift safety:** fileVersion mismatch blocks apply and provides a recovery ladder.
- **Agent friction minimization:** apply calls should not require “re-stating” the entire plan payload.

## Implementation (this repo)

### Harnesses / commands

- Change/write apply handshake (minimal args + safety): `npm run smoke:adr-088-change-write-minimal-apply`
- Change/write deep trust suite (session drift tolerance, draft target safety, invalid token, fileVersion mismatch): `npm run smoke:adr-088-change-write-deep`
- Stdio protocol stress: `npm run smoke:adr-088-stdio-stress`
- Compact guidance closure: `npm run smoke:adr-088-stdio-guidance-closure`
- Search quality gate: `npm run benchmark:adr-088-search-accuracy`
- Pairwise env-var sampling: `npm run benchmark:adr-088-env-matrix`
- Long-run stability: `npm run benchmark:adr-088-long-run`
- Guidance-driven agent loop simulator: `npm run benchmark:adr-088-agent-loop`

Reports are written to `benchmarks/reports/adr-088-*.json`.

### CI wiring

Workflow: `.github/workflows/adr-088-verification.yml`

Hard gates include:
- JSON parse validity.
- Compact guidance tool safety (`task`/`manage` only).
- Apply handshake closure (plan returns a runnable nextCall for apply; apply blocks without token).
- Stdio cleanliness (no stdout protocol corruption).

## Notable trust fixes landed during ADR-088 runs

- **Session normalization for apply tokens:** when `draftId` is present, token/session validation is derived from the draft session to tolerate host sessionId drift (keeps “apply” from failing with `apply_token_missing` due to host wiring).
- **Write apply draft-target safety:** when applying a write draft, `targetPath` must match the draft’s target; mismatches are blocked to prevent mis-application.

## References / artifacts

- Local (detailed, Korean): `.archive/ADR-088-agent-trust-e2e-verification-and-optimization-program.md`
- Local run report snapshot (Korean): `.archive/adr-088/report.md` (mirrors `./report.md`)

