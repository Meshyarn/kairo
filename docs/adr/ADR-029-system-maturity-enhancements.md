# ADR-029: System Maturity Enhancements (Production Readiness) (Historical)

**Status:** Proposed (2025-12-17)

## Context

Three production readiness gaps were highlighted:

- Slow cold starts from sequential I/O in indexing/restoration.
- Oversized “god files” (Search/Skeleton) hurting maintainability.
- Fixed hybrid search weights limiting relevance tuning per query type.

## Decision

Adopt a phased maturity plan:

- Parallelize indexing cold start paths (batch stat/restore; avoid sync I/O in async flows).
- Refactor core modules into smaller SRP components (tokenization, candidate collection, scoring,
  post-processing, etc.).
- Make search “ML-ready” by normalizing signals and enabling adaptive weighting.
- Parallelize scoring and improve background queue behavior for scaling.

## Consequences

Improves first-run UX and sets up the codebase for long-term evolution (tunable ranking and more
predictable performance).

