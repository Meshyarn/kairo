# ADR-060: Document Tool Parity (PDF/XLSX)

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`, `docs/adr/ADR-059-evidence-pack-and-summaries-lifecycle-prune-compact.md`

Align document indexing and document tools to use the same extraction/normalization pipeline, ensuring consistent results across PDF/XLSX/DOCX/plain-text formats.

## Decision (v1 Contract)

- Use `DocumentContentLoader` as the single extraction path (indexer + `document_*` tools).
- Normalize PDF/XLSX markers into heading-like structures so section/toc features work consistently.
- Standardize low-quality/cap/extraction-failure signals via `degradedReasons`/`warnings`.

## Implementation Notes

- Loader: `src/documents/DocumentContentLoader.ts`
- DocumentHandlers integration: `src/handlers/DocumentHandlers.ts`
- DocumentIndexer integration: `src/indexing/DocumentIndexer.ts`
- File-level warnings in `document_search`: `src/documents/search/DocumentSearchEngine.ts` (`fileMeta`)
- Extractor stats improvements (PDF/XLSX/Docx): `src/documents/extractors/PdfExtractor.ts`, `src/documents/extractors/XlsxExtractor.ts`, `src/documents/extractors/DocxExtractor.ts`
- Degraded reason mapping: `src/orchestration/DegradedReasonMapper.ts`

## Implementation Status (as of current code)

- [x] Phase A: `document_*` tools support PDF/XLSX extraction via the loader
- [x] Phase A: marker → heading conversion + standardized degradedReasons/warnings
- [x] Phase B: DocumentIndexer also uses the loader to align indexing/tool outputs
- [x] Phase C: marker-conversion tests + ToolSpec/docs updates

## Testing

- Marker-conversion unit tests: `src/tests/documents/DocumentContentLoader.test.ts`
