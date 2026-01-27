# ADR-028: Performance and Accuracy Enhancements (Historical)

**Status:** Proposed (2025-12-16)

## Context

Large projects exposed critical gaps:

- Multi-keyword `search_project` queries missing obvious files.
- `analyze_relationship` failing to detect import edges reliably.
- Repeated skeleton reads reparsing unchanged files.
- Slow “warm start” due to uncertain index persistence behavior.

## Decision

Define a phased improvement plan:

- **Persistent trigram indexing** to avoid expensive rebuilds across restarts.
- **AST-based import extraction** to improve relationship graph accuracy.
- **Hybrid search** that combines filename/content/symbol/trigram signals for better recall.
- **Skeleton caching** keyed by mtime to eliminate redundant parse work.

## Consequences

Moves the system toward “fast warm start + high recall search + reliable graphs” on 1k–10k file
repos, while keeping the architecture incremental and testable.

