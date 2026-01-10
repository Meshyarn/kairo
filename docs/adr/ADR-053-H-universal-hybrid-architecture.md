# ADR-053-H: Universal Hybrid Architecture & Capability Registry (Summary)

**Status:** Implemented
**Date:** 2026-01-10
**Base:** `docs/adr/ADR-052-pillar-option-profiles-and-session-policy.md`, `docs/adr/ADR-053-hybrid-rust-architecture-and-optimization.md`
**Related:** `docs/adr/ADR-054-cross-language-contract-awareness.md` (separate scope)

## Summary

ADR-053-H replaces point-to-point native imports with a centralized capability registry. Call sites request a capability; the registry selects the best available provider (native > wasm > js) and exposes diagnostics. Native module loading is centralized and single-shot.

## Decision

- **Capabilities** are stable IDs (ex: `CAP_CHUNKING_TOKENS`, `CAP_DIFF_UNIFIED`).
- **Providers** implement a typed interface and declare tier/priority.
- **EngineManager** registers providers, selects by availability/priority, and reports diagnostics.
- **NativeModuleLoader** is the only place that loads `@kairo/core-rs` (lazy, warn-once).
- **Feature flags** allow disabling Rust globally or per-capability.

## Implemented Architecture

### Capability catalog (current)

- `CAP_CHUNKING_TOKENS`: tokenizer-aware chunking
- `CAP_DIFF_UNIFIED`: unified diff
- `CAP_SYNTAX_VALIDATE`: syntax validation
- `CAP_VECTOR_COSINE_BATCH`: vector cosine batch
- `CAP_TEXT_STATS`: text stats (js-only)

### Providers (current)

- Native: Rust providers for chunking/diff/syntax/vector (when core is available)
- WASM: Tree-sitter syntax fallback, optional wasm chunking
- JS: diff, vector, chunking, text stats

### Diagnostics

`EngineManager.getDiagnostics()` reports selected provider and fallback per capability plus Rust core load state.

## Behavior Changes

- Direct `@kairo/core-rs` imports are removed from call sites.
- Legacy wrapper singletons were deleted; callers use `EngineManager.getProvider(...)`.
- Chunking selection can respect profile hints (native preferred for fast/deep).

## Testing & Performance

- Registry lookup micro-benchmark added; average lookup < 1ms.
- Registry path within ±5% of direct call baseline (perf check).
- `npm run test:perf` and LOD benchmarks pass on macOS.

## Out of Scope

- Cross-language contract inference is handled in ADR-054.
- Multi-language native engines (Go/C++) are not implemented in this patch.

