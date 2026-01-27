# ADR-049: Integrity Engine Defensive Hardening (Historical)

**Status:** Proposed (2026-01-10)

## Context

After adding baseline architectural guardrails (ADR-048), real-world tests still showed gaps:

- Layer violations and cycles not reliably escalated.
- “Core” files (high fan-in) sometimes passed with low risk.
- Protocol-sensitive areas (stdout pollution) lacked protection.
- Public API changes weren’t treated as high-impact events by default.

## Decision

Strengthen preflight/apply enforcement with a “single decisive refusal” contract:

- **Layer-aware cycle detection:** simulate dependency changes and detect both cycles and layer-rule
  violations.
- **Core protection escalation:** automatically treat changes to core files as high risk and return
  safety checklists.
- **Protocol violation scanning:** protect sensitive files/paths with forbidden-token rules.
- **Public surface monitoring:** detect export surface changes and escalate when blast radius is high.

## Consequences

Makes architectural integrity an enforceable policy (not just advisory warnings), with stable
reason codes so agents can automate recovery strategies.

