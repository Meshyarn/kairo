# ADR-011: Robustness, Format Flexibility, and Advanced Analysis (Historical)

**Status:** Proposed (2024-12-07)

## Context

After introducing AST parsing (ADR-010), production gaps remained:

- Fragile language detection (`.js` + JSX) and unreliable runtime fallback.
- First-use WASM load latency.
- No structured schema for skeleton output (hard to consume programmatically).
- Symbol search risked O(N) parsing per query on large repos.

## Decision

Harden the semantic layer with:

- **Robust language policy:** parse JS/JSX/TS/TSX using the TSX grammar to avoid fallback hacks.
- **Warm-up:** load common grammars asynchronously at startup (non-blocking).
- **Structured outputs:** add JSON skeleton extraction with precise ranges/signatures.
- **Scalable symbol search:** cache extracted symbols per file keyed by mtime; cap results.

## Consequences

Makes “structure-first” workflows reliable and fast enough for real repositories, while setting up
later memory-bounded caching/eviction work.

