# 설정(레거시: 전체 환경 변수)

Kairo는 환경 변수로 설정합니다. 대부분의 사용자는 몇 가지만 필요합니다.

읽기 쉬운 “분할 레퍼런스”는 여기서 시작하세요:

- [설정(Configuration) — 분할 레퍼런스](/ko/reference/configuration/)

::: warning 레거시 문서
이 문서는 레거시 링크/검색을 위한 단일 “전체 환경 변수” 페이지입니다. 최신 문서는 위의 분할 레퍼런스를 기준으로 합니다.

`.kairo/config/*` 설정 파일이 필요하다면: [프로젝트 설정 파일](/ko/reference/configuration/project-files)
:::

## 공통 환경 변수

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_ROOT_PATH` | 분석할 프로젝트 루트. | cwd보다 권장; CLI `--root` 인자와 동일. |
| `KAIRO_ROOT` | 분석할 프로젝트 루트. | `KAIRO_ROOT_PATH`의 alias. |
| `KAIRO_MODE` | 정책 모드. | `mcp`(기본), `dev`, `ci`. MCP 기본값을 끄려면 `dev`. |
| `KAIRO_PRESET` | MCP preset. | `mcp-balanced`(기본; ADR-091), `mcp-lean`, `mcp-deep`. |
| `KAIRO_PUBLIC_SURFACE` | 공개 도구 표면. | `compact`(mcp에서 기본; `task`+`manage`만) 또는 `pillars`(Five Pillars). |
| `KAIRO_DIR` | 데이터 디렉터리. | 기본값 `.kairo` (index/cache/history 포함). |
| `KAIRO_ALLOW_LEGACY_MCP_DIR` | `KAIRO_DIR`에 대해 레거시 `.mcp` 경로를 허용. | `true`면 `.mcp`/`.mcp/kairo` 허용; 아니면 `.kairo` 사용. |
| `KAIRO_MAX_RESULTS` | 검색 결과 상한. | 토큰 효율을 위해 낮추고, 리콜을 위해 높이세요. |
| `KAIRO_LOG_LEVEL` | 구조화 로그 레벨. | `debug|info|warn|error`. |
| `KAIRO_LOG_TO_FILE` | `.kairo` 아래에 로그를 파일로 저장. | MCP 호스트에서는 권장(stdout를 깨끗하게 유지). |
| `KAIRO_ALLOW_STDOUT_LOGS` | stdout 로그 허용. | MCP 호스트에서는 피하세요(stdout는 MCP 프레임 전용). |
| `KAIRO_LOG_DIR` | 로그 디렉터리 오버라이드. | 기본값 `<KAIRO_DIR>/logs`. |
| `KAIRO_LOG_FILE` | 로그 파일 경로 오버라이드. | 설정 시 모든 로그를 단일 파일로 기록. |
| `KAIRO_STORAGE_MODE` | 스토리지 백엔드. | `file`(기본) 또는 `memory`(비영속). |
| `KAIRO_TOOL_SCHEMA_MODE` | 도구 스키마 모드(계약 enforcement). | `compat`(기본)은 알 수 없는 top-level 필드를 제거; `strict`는 거부. |
| `KAIRO_EXPOSE_INTERNAL_TOOLS` | MCP `list_tools`에 내부 도구를 노출. | 기본 `false`; 내부 도구 이름은 불안정. |
| `KAIRO_EXPOSE_FILE_TOOLS` | MCP `list_tools`에 compat file tools를 노출. | 기본 `false`; 가능하면 Five Pillars 선호. |

타임아웃은 주로 MCP 호스트(요청 단위 타임아웃)가 제어합니다. 일부 작업은 `limits.timeoutMs`로 호출 단위 타임아웃도 지원합니다(`docs/ko/agent/TOOL_REFERENCE.md` 참고).

## 베타 텔레메트리(opt-in)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_BETA_LOG_ENABLED` | 베타 텔레메트리 로그 활성화. | `.kairo/logs/beta.ndjson` 아래에 sanitize된 NDJSON를 기록. |
| `KAIRO_BETA_LOG_PATH` | 베타 로그 경로 오버라이드. | 기본값 `${KAIRO_LOG_DIR}/beta.ndjson`. |
| `KAIRO_HOST_NAME` | 베타 로그 엔트리에 태그. | 멀티 호스트 테스트 시 호스트 식별자(선택). |

## manage import 안전

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_MANAGE_IMPORT_ALLOW_EXTERNAL` | `.kairo` 밖에서 `manage import`를 허용. | 기본 `false`; 필요한 경우에만 opt-in. |

## drift 체크(ADR-077)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_DRIFT_CHECK_MAX_FILES` | 워크스페이스 drift 계산 시 샘플링하는 최대 인덱싱 파일 수. | 기본 200. |
| `KAIRO_FORMATTER_MAX_FILES` | formatter bridge apply의 최대 파일 수. | 기본 10. |
| `KAIRO_FORMATTER_ALLOW_UNTRACKED` | undo/rollback이 가능하더라도 formatter bridge가 기록되지 않는(히스토리 미추적) 쓰기를 허용. | 기본 `false`. |
| `KAIRO_PATCH_STORAGE_WARN_FREE_PCT` | 패치 원장(ledger) 디스크 여유 경고 임계값(%). | 기본 8. |
| `KAIRO_PATCH_STORAGE_BLOCK_FREE_PCT` | 패치 원장(ledger) 디스크 여유 차단 임계값(%). | 기본 3. |
| `.kairo/config/scopes.json` | 수동 scope 오버라이드. | 선택; drift 그룹핑을 위한 `serviceRoot` scopes 정의. |
| `KAIRO_SCALE_TIER_S_MAX_FILES` | 스케일 티어 S의 최대 파일 수. | 기본 5000. |
| `KAIRO_SCALE_TIER_M_MAX_FILES` | 스케일 티어 M의 최대 파일 수. | 기본 50000. |

## 적응형 LOD(ADR-078)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_ADAPTIVE_LOD_ENABLED` | 적응형 프로파일 downshift 활성화. | 기본 `true`; 비활성화하려면 `false`. |
| `KAIRO_ADAPTIVE_LOD_WINDOW` | 슬라이딩 윈도우 크기(호출 수). | 기본 12. |
| `KAIRO_ADAPTIVE_LOD_COOLDOWN_CALLS` | 복구를 허용하기 전 쿨다운 호출 수. | 기본 20. |

## 스토리지 유지보수(ADR-059)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_STORAGE_PRUNE_INTERVAL_MS` | 백그라운드 prune 주기(ms). | `0`/미설정이면 백그라운드 prune 비활성화. |
| `KAIRO_STORAGE_PRUNE_ON_START` | 시작 시 prune 1회 실행. | `true`로 활성화. |
| `KAIRO_STORAGE_PRUNE_FLOW_ARTIFACTS` | prune에 flow artifacts 포함. | `true`로 활성화. |
| `KAIRO_STORAGE_PRUNE_TEMP_FILES` | prune에 temp files 포함(`.kairo/tmp`, `.kairo/temp`). | `true`로 활성화. |
| `KAIRO_STORAGE_PRUNE_COMPACT` | prune 이후 compact rewrite 수행. | `true`로 활성화. |
| `KAIRO_TASK_EVIDENCE_TTL_MS` | task evidence pack TTL(ms). | 기본 `1800000` (30분). |
| `KAIRO_EVIDENCE_PACK_MAX_COUNT` | evidence pack 최대 개수 상한. | 기본 ~300. |
| `KAIRO_EVIDENCE_PACK_MAX_BYTES` | evidence pack 바이트 상한. | 기본 100MB. |
| `KAIRO_EVIDENCE_PACK_STALE_CHECK_MAX_ITEMS` | evidence pack stale 샘플링 상한. | 기본 24 items. |
| `KAIRO_CHUNK_SUMMARY_MAX_CHUNKS` | chunk summary 최대 chunk 수. | 기본 20k. |
| `KAIRO_CHUNK_SUMMARY_MAX_BYTES` | chunk summary 바이트 상한. | 기본 100MB. |
| `KAIRO_TEMP_FILE_TTL_MS` | temp file TTL(ms). | 기본 `604800000`(7일). `temp_files` prune 시 사용. |
| `KAIRO_TEMP_FILE_MAX_COUNT` | temp file 최대 개수 상한. | 기본 `0`(상한 없음). `temp_files` prune 시 사용. |

## 원문 소스(ContentSource) (ADR-089)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_CONTENT_SOURCE_MAX_BYTES` | `contentSource.kind="file"` 읽기 최대 바이트. | 기본 `1048576`(1MB). |

## 프로젝트 설정 파일(권장)

프로젝트 로컬 설정은 대상 프로젝트 루트의 `.kairo/config/*` 아래에 위치합니다.

이 레거시 문서는 env 변수 중심이며, 파일 기반 설정의 최신 문서는 분할 레퍼런스를 기준으로 합니다:

- [프로젝트 설정 파일](/ko/reference/configuration/project-files)
- [로깅 & 텔레메트리](/ko/reference/configuration/logging-and-telemetry)
- [검색 & 임베딩](/ko/reference/configuration/search-and-embeddings)
- [change/write & drift](/ko/reference/configuration/change-write-and-drift)

팁: `manage({ command: "init", mode: "apply" })`로 starter skeleton을 생성할 수 있습니다.

## 문서 / 파서

| 변수 | 용도 |
|---|---|
| `KAIRO_WASM_DIR` | tree-sitter WASM assets(Markdown/SQL WASM 포함)를 해석하는 위치. |

### 문서 추출 리밋

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_DOC_MAX_FILE_BYTES` | 텍스트 파일을 샘플링하기 전 최대 바이트. | head/tail 샘플링을 트리거. |
| `KAIRO_DOC_SAMPLE_HEAD_BYTES` | 샘플링 시 시작 부분에서 유지할 바이트 수. | 텍스트 기반 문서에 적용. |
| `KAIRO_DOC_SAMPLE_TAIL_BYTES` | 샘플링 시 끝 부분에서 유지할 바이트 수. | 텍스트 기반 문서에 적용. |
| `KAIRO_PDF_MAX_PAGES` | PDF에서 추출할 최대 페이지 수. | 큰 PDF에서 추출 상한. |
| `KAIRO_PDF_MAX_CHARS` | PDF에서 추출할 최대 총 문자 수. | `pdf_char_cap` 트리거. |
| `KAIRO_PDF_MIN_CHARS` | `pdf_needs_ocr` 전에 필요한 최소 문자 수. | OCR 필요 신호. |
| `KAIRO_PDF_MIN_CHARS_PER_PAGE` | `pdf_low_text_density` 전에 페이지당 필요한 최소 문자 수. | 텍스트 밀도 낮음 신호. |
| `KAIRO_XLSX_MAX_SHEETS` | XLSX에서 추출할 최대 시트 수. | 추출 상한. |
| `KAIRO_XLSX_MAX_ROWS` | 시트당 최대 행 수. | 추출 상한. |
| `KAIRO_XLSX_MAX_COLS` | 시트당 최대 열 수. | 추출 상한. |

## 토큰 예산(ADR-056)

Kairo는 `limits.maxChars`(문자 상한) 외에도 `limits.maxTokens`(토큰 우선)를 사용해 응답을 제한할 수 있습니다. 응답 envelope post-pass에 대해서는 `docs/adr/ADR-080-response-envelope-token-budget-explore-understand.md`를 참고하세요.

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_DEFAULT_MAX_TOKENS` | 기본 토큰 예산(서버 측). | pillar가 자체 기본값을 지정하지 않았고 호출이 `limits.maxTokens`를 전달하지 않았을 때 사용. |
| `KAIRO_EXPLORE_MAX_TOKENS` | `explore` 기본 토큰 예산. | `KAIRO_DEFAULT_MAX_TOKENS`를 오버라이드. |
| `KAIRO_UNDERSTAND_MAX_TOKENS` | `understand` 기본 토큰 예산. | `KAIRO_DEFAULT_MAX_TOKENS`를 오버라이드. |
| `KAIRO_READ_MAX_TOKENS` | `read` 기본 토큰 예산. | `KAIRO_DEFAULT_MAX_TOKENS`를 오버라이드. |
| `KAIRO_MANAGE_MAX_TOKENS` | `manage` 응답 기본 토큰 예산. | `manage command=artifact` envelope caps에 사용. |
| `KAIRO_MANAGE_MAX_CHARS` | `manage` 응답 기본 JSON 문자 상한. | `manage command=artifact` envelope caps에 사용. |
| `KAIRO_TOKEN_ESTIMATOR` | 토큰 추정기 모드. | `whitespace`(기본) 또는 `chars`. |

## deprecated env vars

이 환경 변수들은 아직 동작하지만, 향후 릴리스에서 제거될 예정입니다:

- `KAIRO_ROOT` → `KAIRO_ROOT_PATH` 또는 `--root` 사용
- `KAIRO_EXPOSE_LEGACY_TOOLS` → `KAIRO_EXPOSE_INTERNAL_TOOLS` 사용
- `KAIRO_EXPOSE_COMPAT_TOOLS` → `KAIRO_EXPOSE_FILE_TOOLS` 사용
- `KAIRO_ALLOW_LEGACY_MCP_DIR` → 레거시 `.mcp` 경로는 deprecated

## 네이티브 엔진 토글(ADR-053-H)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_RUST_CORE_ENABLED` | Rust 코어를 전역 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_CHUNKING_ENABLED` | Rust chunking 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_DIFF_ENABLED` | Rust diffing 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_SYNTAX_ENABLED` | Rust 문법 검증 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_VECTOR_ENABLED` | Rust vector math 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_SYMBOLIC_SOLVER_ENABLED` | Rust symbolic solver capability 활성화. | `on/off` (기본: on; Rust core enabled일 때만). |
| `KAIRO_WASM_CHUNKING_ENABLED` | WASM chunking provider 활성화. | `on/off` (기본: off). |
| `KAIRO_RUST_CHUNKING` | 레거시 Rust chunking 토글. | 역호환; `KAIRO_RUST_CHUNKING_ENABLED` 권장. |
| `KAIRO_TOKENIZER_PATH` | `tokenizer.json`의 절대 경로. | 선택; Kairo가 표준 cache/model 경로에서 자동 탐색. |
| `KAIRO_DOC_CHUNK_PROFILE` | 인덱싱용 기본 토큰 chunk 프로파일. | `fast/balanced/deep` (outlineOptions가 오버라이드하지 않을 때만 사용). |

## Skeleton(대형 파일)

| 변수 | 용도 |
|---|---|
| `KAIRO_SKELETON_AUTO_MINIMAL_LINES` | line count가 임계값을 넘으면 `detailLevel=minimal`로 자동 전환(0이면 비활성). |

## 임베딩(선택)

| 변수 | 용도 |
|---|---|
| `KAIRO_EMBEDDING_PROVIDER` | 임베딩 백엔드 선택(`local`, `remote`, `hash`, `disabled`). | `remote`는 opt-in이며 HuggingFace 다운로드를 활성화합니다. |
| `KAIRO_EMBEDDING_QUANTIZED` | 양자화 모델 사용(`true`/`false`). | 기본 `true` (int8/q8). 전체 정밀도(fp32/fp16)는 `false`. |
| `KAIRO_EMBEDDING_MODEL` | 번들/로컬 모델 식별자(기본: `multilingual-e5-small`). |
| `KAIRO_MODEL_DIR` | 번들 모델 디렉터리 오버라이드(원격 다운로드 없음). |
| `KAIRO_MODEL_CACHE_DIR` | 로컬 모델 캐시 디렉터리 오버라이드. |
| `KAIRO_EMBEDDING_E5_PREFIX` | E5 `query:`/`passage:` prefixing 활성화(기본: true). |

로컬 모델 폴더 이름은 `KAIRO_EMBEDDING_MODEL`과 일치해야 합니다. 다운로드/준비 단계는 `docs/ko/guides/getting-started.md`를 참고하세요.

## 임베딩 팩(P2 선택)

대형 레포에서 임베딩을 바이너리 팩으로 저장하면(레거시 JSON+base64 대비) 복원 시간과 디스크 사용량을 줄일 수 있습니다.

| 변수 | 용도 |
|---|---|
| `KAIRO_EMBEDDING_PACK_FORMAT` | 팩 저장 활성화: `float32`, `q8`, `both` (미설정 = disabled/legacy). |
| `KAIRO_EMBEDDING_PACK_REBUILD` | 정책: `auto`(팩 없으면 마이그레이션), `on_start`(레거시에서 강제 rebuild), `manual`(자동 없음). |
| `KAIRO_EMBEDDING_PACK_INDEX` | 인덱스 포맷: `json`(기본) 또는 `bin`(큰 팩용 바이너리 인덱스). |
| `KAIRO_VECTOR_CACHE_MB` | on-demand embedding vector cache의 최대 MB. |

레거시 `.kairo/storage/embeddings.json`를 `.kairo/storage/v1/embeddings/<provider>/<model>/`로 마이그레이션하려면 `kairo-migrate-embeddings-pack`을 사용하세요.
레거시 임베딩이 존재할 때 시작 시 자동 마이그레이션하려면 `KAIRO_EMBEDDING_PACK_REBUILD=auto`(또는 강제 rebuild는 `on_start`)로 설정합니다.

## 벡터 인덱스(P1)

| 변수 | 용도 |
|---|---|
| `KAIRO_VECTOR_INDEX` | 벡터 인덱스 백엔드(`auto`, `off`, `bruteforce`, `hnsw`). |
| `KAIRO_VECTOR_INDEX_REBUILD` | rebuild 정책(`auto`, `on_start`, `manual`). |
| `KAIRO_VECTOR_INDEX_SHARDS` | 대형 레포용 샤드 수(`off`, `auto`, 또는 숫자). |
| `KAIRO_VECTOR_INDEX_MAX_POINTS` | ANN build의 인덱스 크기 상한. |
| `KAIRO_VECTOR_INDEX_M` | HNSW M 파라미터. |
| `KAIRO_VECTOR_INDEX_EF_CONSTRUCTION` | HNSW build 파라미터. |
| `KAIRO_VECTOR_INDEX_EF_SEARCH` | HNSW search 파라미터. |

`KAIRO_VECTOR_INDEX_REBUILD=manual`일 때는 CLI `kairo-build-vector-index`를 사용하세요.

## 네이티브 검색(ADR-085)

Kairo의 file/doc 검색은 네이티브 모듈(`@kairo/core-rs`)을 통해 Tantivy로 동작합니다. 레거시 Trigram 인덱스는 제거되었습니다.

- ADR 요약: `docs/adr/ADR-085-rust-native-search-core-tantivy.md`
- 인덱스 디렉터리: `${KAIRO_DIR}/data/index[/repos/<repoId>]/v2-tantivy`
- 헬스 점검: `manage({ command: "status" })` → `nativeSearch.available`, `nativeSearch.stats.docCount`, `nativeSearch.stats.writeEnabled` (writer lock 때문에 인덱스가 read-only로 열리면 false)
- rebuild: `manage({ command: "reindex" })`

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_RUST_CORE_ENABLED` | Rust core(네이티브 검색 포함) 활성/비활성. | 기본 `true`. |

## 대형 레포 성능

| 변수 | 용도 |
|---|---|
| `KAIRO_INDEX_SCAN_BATCH_SIZE` | 초기 스캔 중 N 엔트리 처리 후 event loop에 yield. |
| `KAIRO_INDEX_IGNORE_BATCH_SIZE` | `.gitignore` reindex 스윕 중 yield. |
| `KAIRO_DOC_MAX_CANDIDATES` | 문서 검색 후보 파일 수 상한. |
| `KAIRO_DOC_MAX_CHUNK_CANDIDATES` | 문서 검색 chunk 후보 상한. |
| `KAIRO_DOC_MAX_VECTOR_CANDIDATES` | 문서 검색에서 벡터 후보 상한. |
| `KAIRO_DOC_FALLBACK_MAX_FILES` | doc candidates가 없을 때 fallback 리스트 상한. |
| `KAIRO_DOC_LIST_FAST` | 문서 파일 리스트 정렬을 생략(대형 레포에서 더 빠름). |

## 베이스라인 인덱싱 + 심볼 검색

| 변수 | 용도 |
|---|---|
| `KAIRO_BASELINE_ENABLED` | 시작 시 베이스라인 인덱싱 활성화(`auto|on|off`). |
| `KAIRO_BASELINE_BLOCKING` | 심볼 검색이 베이스라인을 기다리도록 강제(`true/false`). |
| `KAIRO_BASELINE_MAX_MS_PER_TICK` | tick당 최대 베이스라인 인덱싱 시간(ms). |
| `KAIRO_BASELINE_MAX_FILES_PER_TICK` | tick당 처리할 최대 파일 수. |
| `KAIRO_SYMBOL_SECONDARY_INDEX` | 보조 심볼 인덱스 활성화(`auto|on|off`). |
| `KAIRO_SYMBOL_SECONDARY_INDEX_MAX_BYTES` | 보조 인덱스 파일 크기 상한(bytes). |
| `KAIRO_SYMBOL_SEARCH_MAX_CANDIDATES` | 보조 인덱스 검색에서 평가할 최대 후보 refs. |
| `KAIRO_SYMBOL_FUZZY_SEARCH` | fuzzy 심볼 검색 활성화(`auto|on|off`). |
| `KAIRO_SYMBOL_FUZZY_MAX_FILES` | `auto`에서 fuzzy 검색의 최대 파일 수. |

## 패키징(model bundle)

| 변수 | 용도 |
|---|---|
| `KAIRO_MODEL_SOURCE` | `npm run bundle:models`가 사용하는 source 디렉터리(모델 루트 또는 상위). |
| `KAIRO_SKIP_MODEL_BUNDLE` | `prepack`에서 번들링을 건너뜀(`true`면 skip). |
| `KAIRO_MODEL_BUNDLE_PROFILE` | 번들 프로파일(`minimal` 기본, 모든 assets 포함은 `full`). |

## 무결성 감사(ADR-041)

| 변수 | 용도 |
|---|---|
| `KAIRO_INTEGRITY_MODE` | 기본 integrity 동작. |
| `KAIRO_INTEGRITY_SCOPE` | 기본 scope(`docs` vs `project` vs `auto`). |
| `KAIRO_INTEGRITY_BLOCK_POLICY` | high-severity findings가 apply를 차단할지 여부. |

## 모듈러 롤아웃(ADR-045)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_MODULAR_HANDLERS_ENABLED` | 모듈러 handler registry 토글. | `true/false`가 percent를 오버라이드. |
| `KAIRO_UNIFIED_EXTRACTION_ENABLED` | unified extraction pipeline 토글. | `true/false`가 percent를 오버라이드. |
| `KAIRO_PILLAR_DECOMPOSITION_ENABLED` | 분해된 pillar 모듈 토글. | `true/false`가 percent를 오버라이드. |
| `KAIRO_MODULAR_ROLLOUT_PERCENT` | 모듈러 플래그 롤아웃 퍼센트. | `0-100`; rollout user hashing 사용. |
| `KAIRO_ROLLOUT_USER` | 롤아웃 hashing용 기본 user ID. | 호스트가 user ID를 전달하지 않으면 사용. |

## 적응형 플로우 롤아웃(ADR-075)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_ROLLOUT_MODE` | 롤아웃 preset(`legacy|shadow|canary|beta|full`). | 기본 preset 스위치. |
| `KAIRO_ROLLOUT_PHASE` | `KAIRO_ROLLOUT_MODE`의 alias. | 역호환을 위해 유지. |
| `KAIRO_ROLLOUT_CANARY_USERS` | canary allowlist. | 콤마로 구분된 user IDs. |
| `KAIRO_ROLLOUT_BETA_PERCENT` | beta 롤아웃 퍼센트. | `0-100`. |
| `KAIRO_ROLLOUT_FORCE` | preset 적용을 강제. | 명시적 env overrides가 있어도 적용. |
| `KAIRO_ADAPTIVE_FLOW_ENABLED` | Adaptive Flow 플래그 오버라이드. | `on|off|canary|beta|full` (optional payload). |
| `KAIRO_UCG_ENABLED` | UCG 플래그 오버라이드. | 위와 동일. |
| `KAIRO_TOPOLOGY_SCANNER_ENABLED` | topology scanner 플래그 오버라이드. | 위와 동일. |
| `KAIRO_DUAL_WRITE_VALIDATION` | dual-write validation 토글. | 위와 동일. |
| `KAIRO_TOPOLOGY_SUCCESS_MIN` | topology 성공률 알림 임계값. | 기본 `0.95`. |
| `KAIRO_UCG_MEMORY_MAX_MB` | UCG 메모리 추정치 알림 임계값. | 기본 `500`. |
| `KAIRO_L3_PROMOTION_RATIO_MAX` | L3 승격 비율 알림 임계값. | 기본 `0.5`. |

## Writer's flow 기본값(ADR-051)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_WRITERS_FLOW_DEFAULT_DRYRUN` | sessionId가 있을 때 writer flow의 기본 dry-run. | `on|off|beta|canary` |
| `KAIRO_WRITERS_FLOW_REVIEW_DEFAULTS` | 세션 기반 reviewOptions 기본값 활성화. | `on|off|beta|canary` |

## StylePack 캐시(ADR-051)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_STYLE_PACK_TTL_MS` | 세션 간 StylePack 재사용 캐시 TTL. | 기본 `1800000` (30분). |
| `KAIRO_STYLE_PACK_CACHE_SIZE` | 캐시되는 StylePack 최대 개수. | 기본 `50`. |
| `KAIRO_CALLGRAPH_MAX_NODES` | call graph artifacts에 저장할 최대 노드 수. | 기본 `500`. |
| `KAIRO_CALLGRAPH_MAX_EDGES` | call graph artifacts에 저장할 최대 엣지 수. | 기본 `1500`. |

## 전체 목록(source of truth)

코드베이스에서 검색하세요: `rg "process\\.env\\.KAIRO_" src`.
