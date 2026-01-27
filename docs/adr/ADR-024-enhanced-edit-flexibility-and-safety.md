# ADR-024: Enhanced Edit Flexibility and Safety (Historical)

**Status:** Proposed (2025-12-13)

## Context

Real-world agent usage exposed a tension between:

- Strict matching (safe but brittle) and
- Tolerant matching (flexible but potentially risky)

In particular, multi-line edits failed on newline/indent/whitespace drift, and delete operations
were considered dangerously under-guarded compared to replace operations.

## Decision

Improve edit ergonomics without giving up safety guarantees:

- Move from binary match outcomes to **confidence-scored matching** with transparent diagnostics.
- Expand **normalization tiers** (line endings, trailing whitespace, indentation, etc.).
- Make **delete operations** follow the same safety model (hash verification, previews, and
  transactional rollback) instead of bypassing engine checks.

## Consequences

Reduces costly “read → copy → fail → retry” loops while keeping the system explicit about
uncertainty and guardrails.

