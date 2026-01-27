# ADR-001: Kairo Server Architecture (Historical)

**Status:** Proposed (2025-12-06)

## Context

Early `kairo` needed to solve two practical problems for LLM-driven codebase work:

- Avoid wasting tokens by loading whole files when only small regions are relevant.
- Avoid unsafe text replacement (accidental edits when the same pattern appears multiple times).

## Decision

Introduce a staged architecture that separates *finding* from *reading* from *editing*:

- **Scout:** search for keyword hits and return lightweight location hints without file bodies.
- **Read:** load only the relevant intervals (merge/expand line ranges to reduce redundant reads).
- **Replace:** apply edits with a safety engine (uniqueness checks, anchors, fuzzy matching).

## Notes (How It Evolved)

- The “scout/read/replace” split is a direct ancestor of today’s pillar-style workflow contracts
  and progressive disclosure (search first, then targeted reads, then guarded edits).
- Later ADRs replace early tool naming/details, but the core intent (token-efficient retrieval +
  safe edits) remains the same.

