# 성능 & 인덱싱

이 페이지는 **대형 저장소**와 시작/인덱싱 동작에 영향을 주는 설정을 모았습니다.

## 대형 저장소 성능

| 변수 | 용도 |
|---|---|
| `KAIRO_INDEX_SCAN_BATCH_SIZE` | 초기 스캔 중 N 엔트리 처리 후 event loop에 yield. |
| `KAIRO_INDEX_IGNORE_BATCH_SIZE` | `.gitignore` reindex sweeps 중 yield. |
| `KAIRO_DOC_MAX_CANDIDATES` | document search candidate 파일 수 상한. |
| `KAIRO_DOC_MAX_CHUNK_CANDIDATES` | document search chunk candidates 상한. |
| `KAIRO_DOC_MAX_VECTOR_CANDIDATES` | doc search에서 vector candidates 상한. |
| `KAIRO_DOC_FALLBACK_MAX_FILES` | doc candidates가 없을 때 fallback list 상한. |
| `KAIRO_DOC_LIST_FAST` | 문서 파일 목록에서 sorting을 생략(초대형 repo에서 더 빠름). |

## 베이스라인 인덱싱 + 심볼 검색

| 변수 | 용도 |
|---|---|
| `KAIRO_BASELINE_ENABLED` | 시작 시 베이스라인 인덱싱 활성화(`auto|on|off`). |
| `KAIRO_BASELINE_BLOCKING` | 심볼 검색이 베이스라인을 기다리도록 강제(`true/false`). |
| `KAIRO_BASELINE_MAX_MS_PER_TICK` | tick당 베이스라인 인덱싱 최대 시간(ms). |
| `KAIRO_BASELINE_MAX_FILES_PER_TICK` | tick당 처리 최대 파일 수. |
| `KAIRO_SYMBOL_SECONDARY_INDEX` | 2차 심볼 인덱스 활성화(`auto|on|off`). |
| `KAIRO_SYMBOL_SECONDARY_INDEX_MAX_BYTES` | 2차 인덱스 파일 크기 상한(bytes). |
| `KAIRO_SYMBOL_SEARCH_MAX_CANDIDATES` | 2차 인덱스 검색에서 평가되는 candidate refs 상한. |
| `KAIRO_SYMBOL_FUZZY_SEARCH` | fuzzy symbol search 활성화(`auto|on|off`). |
| `KAIRO_SYMBOL_FUZZY_MAX_FILES` | `auto`일 때 fuzzy search의 최대 파일 수. |

