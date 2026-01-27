# ADR-021: Enterprise-Grade Core Enhancements (Architecture & Algorithms) (Historical)

**Status:** Proposed (2025-12-11)

## Context

As `kairo` moved beyond MVP, three bottlenecks limited scale and agent UX:

- Tight coupling to `node:fs` made testing slow/flaky and blocked portability.
- Search/ranking missed common code patterns (CamelCase/substrings) and didn’t use structure.
- Myers diff produced noisy previews for refactors (hard for agents to verify outcomes).

## Decision

Invest in three foundational pillars:

- **Filesystem abstraction (`IFileSystem`):** inject a Node implementation for prod and a memory
  implementation for tests; allow decorators (cached FS) for performance.
- **Advanced search (trigram + structure-aware ranking):** trigram indexing for substring matches;
  field-weighted ranking (BM25F-like) using AST-derived “important ranges”.
- **Semantic diffs:** prefer Patience diff (fallback to Myers for small gaps) to preserve blocks and
  produce readable dry-run previews.

## Consequences

Improves testability and makes “search + preview diff” substantially more useful for agents doing
refactors at scale.

