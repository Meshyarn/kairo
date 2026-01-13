# ADR-060: Document Tool Parity (PDF/XLSX)

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`, `docs/adr/ADR-059-evidence-pack-and-summaries-lifecycle-prune-compact.md`, `docs/plans/loadmap.md`

## Summary

문서 인덱싱과 문서 도구가 동일한 추출/정규화 파이프라인을 사용하도록 정렬해 PDF/XLSX/DOCX/텍스트 포맷 간 결과 일관성을 확보한다.

## Decision (v1 Contract)

- `DocumentContentLoader`를 단일 추출 경로로 사용한다(인덱서 + document_* tools).
- PDF/XLSX marker를 heading 형태로 정규화해 section/toc가 동작하도록 한다.
- 저품질/캡/추출 실패 신호를 `degradedReasons`/`warnings`로 표준화한다.

## Implementation Notes

- Loader: `src/documents/DocumentContentLoader.ts`
- DocumentHandlers 통합: `src/handlers/DocumentHandlers.ts`
- DocumentIndexer 통합: `src/indexing/DocumentIndexer.ts`
- document_search 파일 단위 경고 노출: `src/documents/search/DocumentSearchEngine.ts` (`fileMeta`)
- PDF/XLSX/Docx extractor stats 보강: `src/documents/extractors/PdfExtractor.ts`, `src/documents/extractors/XlsxExtractor.ts`, `src/documents/extractors/DocxExtractor.ts`
- Degraded reason mapping: `src/orchestration/DegradedReasonMapper.ts`

## Implementation Status (현 코드 기준)

- [x] Phase A: document_* 도구가 loader 기반으로 PDF/XLSX 추출 지원
- [x] Phase A: marker → heading 변환 + degradedReasons/warnings 표준화
- [x] Phase B: DocumentIndexer도 loader 사용으로 인덱싱/도구 결과 정렬
- [x] Phase C: marker 변환 테스트 + ToolSpec/문서 업데이트

## Testing

- Marker 변환 단위 테스트: `src/tests/documents/DocumentContentLoader.test.ts`
