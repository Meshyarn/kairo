# ADR-036–039: Universal Documents + Retrieval Ops + Evidence Packs

**Status:** Implemented (curated)  
**Intent:** Make docs first-class so agents can answer “what does this project mean” as well as “what does this code do”.

This document summarizes:

- ADR-036: Markdown/MDX-first document support
- ADR-037: Retrieval quality, embeddings ops, comments indexing, scalable storage
- ADR-038: Evidence packs & progressive disclosure
- ADR-039: Implementation strategy for broader document formats

Kairo treats code and docs as complementary context. The system supports:

- structured document reading (TOC/sections/preview/full)
- doc search that can return *sections* rather than entire files
- progressive disclosure via packs/cursors to control token usage
- optional embeddings/vector search to improve semantic retrieval (offline-first)

## Decision

1) Documents are indexed separately from code but surfaced through `explore`.
2) Markdown is treated as a first-class format for structured navigation.
3) Retrieval is budget-aware: small previews first, then deeper reads on demand.
4) Evidence packs are a core mechanism for “don’t re-send the same context”.

## Implementation notes (current repo)

Document ingestion/search:

- `src/documents/*`
- `src/documents/search/*`
- `src/indexing/DocumentIndexer.ts`
- `src/indexing/DocumentChunkRepository.ts`

Embeddings + vector search (optional):

- `src/embeddings/*`
- `src/vector/*`

Progressive disclosure / packs:

- `src/indexing/EvidencePackRepository.ts`
- `src/orchestration/pillars/explore/*`

## Practical guidance

- Keep docs close to code and let `explore` stitch the evidence together.
- Prefer section-level reads over full reads for large documents.

