# ADR-034: Adaptive Resource Budgets for Navigate/Understand (Historical)

**Status:** Proposed (2025-12-25)

## Context

On large projects, worst-case `navigate`/`understand` requests can trigger expensive scans and
graph work. Agents may misuse tools; the server must stay responsive without forcing retry loops.

## Decision

Add adaptive budgets and progressive refinement:

- Prefer cheap paths by default (filename/symbol-first).
- Enforce caps (candidates/files/bytes/parse time/graph size).
- Escalate in stages only when needed and budget allows.
- Soft-degrade: return partial results + actionable guidance rather than hard failures.

## Consequences

Makes expensive analysis opt-in and bounded, improving stability on large repos while preserving a
usable agent experience.

