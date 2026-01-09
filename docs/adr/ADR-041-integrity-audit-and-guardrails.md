# ADR-041: Integrity Audit Modes (Cross-source Consistency)

**Status:** Implemented (curated)  
**Intent:** Make “safe changes” mean more than “the text patch applied” by validating cross-source constraints (docs/ADR/comments vs code).

## Summary

Kairo’s most expensive failure mode is not a failed edit—it’s a *successful* edit that violates:

- architectural intent described elsewhere in the repo
- product constraints defined in docs/ADRs
- safety expectations expressed in comments/specs

This ADR introduces **integrity auditing as a mode inside existing pillars** (no new public tool):

- `explore`: gather evidence (docs/code snippets) for verification
- `understand`: optionally attach integrity findings to analysis
- `change` / `write`: run preflight checks; block apply on high-severity violations

## Decision

1) No new public “audit” pillar. Integrity is configured via options/modes and integrated into existing flows.
2) Preflight-first safety model:
   - dry-run (planning) should surface warnings and actionable guidance
   - apply should block only on high-severity violations
3) Evidence is **progressively disclosed** (small default responses; expand via `explore`).

## Rejected alternatives

- Add a sixth public “audit” tool/pillar: rejected to avoid surface-area expansion; integrity is an option/mode inside existing pillars.
- Always-block apply on any warning: rejected because it encourages users to disable safety instead of iterating; only high-severity issues should block by default.
- “Trust the patch” (no cross-source checks): rejected because the highest-cost failures are policy/intent violations, not patch failures.

## What “integrity” checks include (pragmatic scope)

- Hard conflicts between explicit constraints (e.g. “must not write outside package boundary”)
- Architectural guardrails (cycles, core-module protection, public surface checks)
- Edit correctness beyond string-match (semantic/syntax validation paths where available)

## Implementation notes (current repo)

Core engines:

- `src/integrity/IntegrityEngine.ts` and `src/integrity/*`
- Guardrails integrated in pillar execution:
  - `src/orchestration/guardrails/IntegrityGuardrails.ts`
  - `src/orchestration/pillars/change/ChangePillar.ts`
  - `src/orchestration/pillars/WritePillar.ts`

Related operational hardening (implemented later, but part of the same safety story):

- ADR-048: tighter sync feedback loops for safety
- ADR-049: defensive hardening (better failure modes + auditability)

## Revisit criteria

Consider adding a dedicated public tool only if integrity work cannot be expressed as an option/mode without making `change`/`write` unusably complex.

## Practical guidance

- For edits: run `change` in dry-run first and look for:
  - `status: "blocked"` / guardrail violations
  - suggested actions to narrow scope or review impacted areas
- If you need stricter behavior, prefer turning on guardrails rather than expanding permissions.
