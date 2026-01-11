# ADR-053: Hybrid Rust Core (Summary)

**Status:** Implemented
**Date:** 2026-01-10
**Follow-up (implemented):** `docs/adr/ADR-053-H-universal-hybrid-architecture.md`

## Summary

ADR-053 introduced a hybrid Node.js + Rust architecture to move compute-heavy paths into a native core (`@kairo/core-rs`) while keeping orchestration in Node.js.

Implemented phases:
- **Phase 1 (Chunking):** Tokenizer-aware chunking via Rust `SmartChunker`, with profile-based token limits and fallback to char chunking.
- **Phase 2 (Diffing):** Rust unified diff generation with JS fallback; profile maps to diff mode.
- **Phase 3 (Syntax):** Rust syntax validation for JS/TS/TSX with Tree-sitter(WASM) fallback.
- **Phase 4 (Vector math):** Rust cosine similarity batch scoring for bruteforce vector search with JS fallback.

The direct Rust imports in TS modules were replaced in **ADR-053-H** with a capability registry and provider selection model.
