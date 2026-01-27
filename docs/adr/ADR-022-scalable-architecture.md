# ADR-022: Scalable Memory Architecture (On-Disk, Lazy, Streaming) (Historical)

**Status:** Proposed

## Context

Fully in-memory indexing and eager scans caused OOM and slow startup on large monorepos. The goal
was “enterprise-scale” behavior: bounded memory, quick startup, and incremental work.

## Decision

Move toward a disk-backed hybrid architecture:

- Persist index data to a local store (SQLite proposed) under `.kairo/`.
- Prefer **lazy/on-demand parsing** (no “parse everything at startup”).
- Make long operations **streaming/incremental** (async iteration, batching, background reindexing).

## Consequences

Reduces memory pressure and improves perceived startup at the cost of more complexity (schema
migrations, I/O and cache management).

