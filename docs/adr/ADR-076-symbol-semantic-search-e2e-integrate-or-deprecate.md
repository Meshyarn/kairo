# ADR-076: Symbol Semantic Search E2E (Integrate or Deprecate)

## Intent

- Remove the “pretends to exist” state and wire an opt-in end-to-end execution path for semantic symbol search.
- Keep default OFF, and operate safely via explicit build/search triggers.
- Use degradedReasons/actions to clearly guide users through readiness/policy issues.

## Progress

- Implemented `SymbolEmbeddingIndex.indexAll` + introduced symbolId format/parsing.
- Store/search symbol embeddings under a modelKey separate from document embeddings.
- Added explicit triggers: `project_manage symbol_index_*` (build/status/clear).
- Added opt-in path: `project_search semanticSymbols=true`, with fallback (name search) and degradedReasons.
- SearchEngine symbol-intent path activates only when `semanticSymbols=true`.
- Added incremental indexing hooks + caps (maxFiles/maxSymbols/bytes/timeout).
- Best-effort skip of redundant re-embedding via mtime caching during incremental indexing.
- Added helper path in `relationship_analyze` for `semanticSymbols=true` (e.g., Understand depth=deep) to assist symbol resolution.

## Implementation Status

- [x] Phase A: minimal wiring (one-time indexAll) + degradedReasons/action standardization
- [x] Phase B: incremental indexing/caching/caps
- [x] Phase C: workflow integration re-evaluation / deprecation decision
