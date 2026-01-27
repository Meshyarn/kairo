# 문서 & 파서

이 페이지는 문서 파싱/추출/청킹(chunking) 관련 설정을 정리합니다.

## 문서 / 파서

| 변수 | 용도 |
|---|---|
| `KAIRO_WASM_DIR` | tree-sitter WASM assets(Markdown/SQL WASM 포함)를 해석하는 위치. |

## 문서 추출 리밋

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_DOC_MAX_FILE_BYTES` | 텍스트 파일을 샘플링하기 전 최대 바이트. | head/tail 샘플링을 트리거. |
| `KAIRO_DOC_SAMPLE_HEAD_BYTES` | 샘플링 시 시작 부분에서 유지할 바이트. | 텍스트 기반 문서에 적용. |
| `KAIRO_DOC_SAMPLE_TAIL_BYTES` | 샘플링 시 끝 부분에서 유지할 바이트. | 텍스트 기반 문서에 적용. |
| `KAIRO_PDF_MAX_PAGES` | PDF에서 추출할 최대 페이지 수. | 큰 PDF에서 추출 상한. |
| `KAIRO_PDF_MAX_CHARS` | PDF에서 추출할 최대 총 문자 수. | `pdf_char_cap` 트리거. |
| `KAIRO_PDF_MIN_CHARS` | `pdf_needs_ocr` 전에 필요한 최소 문자 수. | OCR 필요 신호. |
| `KAIRO_PDF_MIN_CHARS_PER_PAGE` | `pdf_low_text_density` 전에 페이지당 필요한 최소 문자 수. | 텍스트 밀도 낮음 신호. |
| `KAIRO_XLSX_MAX_SHEETS` | XLSX에서 추출할 최대 시트 수. | 추출 상한. |
| `KAIRO_XLSX_MAX_ROWS` | 시트당 최대 행 수. | 추출 상한. |
| `KAIRO_XLSX_MAX_COLS` | 시트당 최대 열 수. | 추출 상한. |

## Skeleton(대형 파일)

| 변수 | 용도 |
|---|---|
| `KAIRO_SKELETON_AUTO_MINIMAL_LINES` | line count가 임계값을 넘으면 `detailLevel=minimal`로 자동 전환(0이면 비활성). |

