# ADR-009: Persistent Index Layer for Scalable Monorepo Support (Historical)

**Status:** Proposed (2025-12-11)

## Context

Scaling issues on large repos were driven by:

- Unbounded in-process index structures (trigram postings, symbol caches, dependency edges).
- Linear startup time from eager indexing.

## Decision

Adopt a three-tier indexing architecture:

- **Hot tier:** small in-memory cache (LRU/LFU/ARC style) for recently accessed items.
- **Warm tier:** persistent on-disk index store (SQLite-based design) for trigrams, symbols, edges,
  and file metadata.
- **Cold tier:** filesystem reads + lazy parsing for files not yet indexed or marked stale.

Support this with an **incremental indexer** (batching, yielding to event loop, optional workers)
and invalidation via file metadata (mtime/hash).

## Consequences

- Lower baseline memory usage and faster perceived startup (index warms progressively).
- Sets the direction for later “offline-first, persistent index” implementations.

