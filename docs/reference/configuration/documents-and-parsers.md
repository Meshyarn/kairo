# Documents & parsers

This page covers document parsing, extraction, and chunking-related knobs.

## Documents / parsers

| Variable | Purpose |
|---|---|
| `KAIRO_WASM_DIR` | Where tree-sitter WASM assets are resolved (including Markdown/SQL WASM). |

## Document extraction limits

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_DOC_MAX_FILE_BYTES` | Max bytes before sampling text files. | Triggers head/tail sampling. |
| `KAIRO_DOC_SAMPLE_HEAD_BYTES` | Bytes kept from the start when sampling. | Applies to text-based docs. |
| `KAIRO_DOC_SAMPLE_TAIL_BYTES` | Bytes kept from the end when sampling. | Applies to text-based docs. |
| `KAIRO_PDF_MAX_PAGES` | Max pages extracted from PDF. | Caps extraction for large PDFs. |
| `KAIRO_PDF_MAX_CHARS` | Max total extracted chars for PDF. | Triggers `pdf_char_cap`. |
| `KAIRO_PDF_MIN_CHARS` | Min chars before `pdf_needs_ocr`. | Signals OCR needs. |
| `KAIRO_PDF_MIN_CHARS_PER_PAGE` | Min chars per page before `pdf_low_text_density`. | Signals low text density. |
| `KAIRO_XLSX_MAX_SHEETS` | Max sheets extracted from XLSX. | Caps extraction. |
| `KAIRO_XLSX_MAX_ROWS` | Max rows per sheet. | Caps extraction. |
| `KAIRO_XLSX_MAX_COLS` | Max columns per sheet. | Caps extraction. |

## Skeleton (large files)

| Variable | Purpose |
|---|---|
| `KAIRO_SKELETON_AUTO_MINIMAL_LINES` | Auto-switch to `detailLevel=minimal` when line count exceeds threshold (0 disables). |

