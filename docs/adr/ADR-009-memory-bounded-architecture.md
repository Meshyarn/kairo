# ADR-009: Memory-Bounded Architecture for Large Projects (Historical)

**Status:** Proposed (2024-12-11)

## Context

Large projects (monorepos / 50k+ files) triggered OOM failures due to unbounded in-memory caches
and eager “index everything at startup” behavior (symbol caches, trigram postings, dependency
graphs, cluster caches).

## Decision

Introduce a tiered, budgeted memory model:

- **Memory budget controller:** enforce soft/hard heap caps and trigger eviction by priority.
- **Tiered storage:** hot in-memory LRU caches; warm on-disk persistent indexes (SQLite/LevelDB);
  cold on-demand parsing for non-indexed files.
- **Lazy indexing:** avoid eager full scans; build/refresh per access and on background schedules.
- **Evictable caches:** standardize cache interfaces so subsystems can be trimmed under pressure.

## Consequences

- Predictable memory ceilings and fewer OOM crashes on large repos.
- Moves the system toward “offline-first indexing with persistence”, later reflected in the hybrid
  Rust + TS architecture decisions.

