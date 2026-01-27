# 검색 & 임베딩

Kairo는 렉시컬 검색(네이티브 코어)과 선택적 벡터 검색(임베딩 + 인덱스)을 지원합니다.

## 임베딩(선택)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_EMBEDDING_PROVIDER` | embedding backend 선택(`local`, `remote`, `hash`, `disabled`). | `remote`는 opt-in이며 HuggingFace 다운로드를 활성화합니다. |
| `KAIRO_EMBEDDING_QUANTIZED` | quantized 모델 사용(`true`/`false`). | 기본: `true` (int8/q8). full precision(fp32/fp16)은 `false`. |
| `KAIRO_EMBEDDING_MODEL` | 번들/로컬 모델 식별자. | 기본: `multilingual-e5-small`. |
| `KAIRO_MODEL_DIR` | 번들된 모델 디렉터리 오버라이드. | 원격 다운로드 없음. |
| `KAIRO_MODEL_CACHE_DIR` | 로컬 모델 캐시 디렉터리 오버라이드. | 선택. |
| `KAIRO_EMBEDDING_E5_PREFIX` | E5 `query:`/`passage:` prefixing 활성화. | 기본: `true`. |

로컬 모델 폴더명은 `KAIRO_EMBEDDING_MODEL`과 일치해야 합니다. 다운로드/준비 단계는 [시작하기](/ko/guides/getting-started)를 참고하세요.

## 임베딩 pack(P2 선택)

대형 저장소에서는 임베딩을 바이너리 pack으로 저장하면(레거시 JSON+base64 대비) 복원 시간과 디스크 사용량을 줄일 수 있습니다.

| 변수 | 용도 |
|---|---|
| `KAIRO_EMBEDDING_PACK_FORMAT` | pack 저장 활성화: `float32`, `q8`, `both` (미설정=비활성/레거시). |
| `KAIRO_EMBEDDING_PACK_REBUILD` | 정책: `auto`(pack 없으면 마이그레이션), `on_start`(레거시에서 강제 재빌드), `manual`(자동 없음). |
| `KAIRO_EMBEDDING_PACK_INDEX` | 인덱스 포맷: `json`(기본) 또는 `bin`(대형 pack용 바이너리 인덱스). |
| `KAIRO_VECTOR_CACHE_MB` | 온디맨드 embedding vector cache 최대 MB. |

`kairo-migrate-embeddings-pack`으로 레거시 `.kairo/storage/embeddings.json`을 `.kairo/storage/v1/embeddings/<provider>/<model>/`로 마이그레이션할 수 있습니다.
레거시 임베딩이 있을 때 시작 시 자동 마이그레이션하려면 `KAIRO_EMBEDDING_PACK_REBUILD=auto`(또는 강제는 `on_start`)를 설정하세요.

## 로컬 모델 패키징(릴리즈 아티팩트)

번들링 시 사용되는 설정:

| 변수 | 용도 |
|---|---|
| `KAIRO_MODEL_SOURCE` | 번들링 시 모델 소스 디렉터리. |
| `KAIRO_MODEL_BUNDLE_PROFILE` | `minimal`(기본) vs `full`. |
| `KAIRO_SKIP_MODEL_BUNDLE` | 번들링 스킵(dev-only). |

## 벡터 인덱스(P1)

| 변수 | 용도 |
|---|---|
| `KAIRO_VECTOR_INDEX` | 벡터 인덱스 backend(`auto`, `off`, `bruteforce`, `hnsw`). |
| `KAIRO_VECTOR_INDEX_REBUILD` | 재빌드 정책(`auto`, `on_start`, `manual`). |
| `KAIRO_VECTOR_INDEX_SHARDS` | 대형 저장소 shard 수(`off`, `auto`, 또는 숫자). |
| `KAIRO_VECTOR_INDEX_MAX_POINTS` | ANN 빌드용 인덱스 크기 상한. |
| `KAIRO_VECTOR_INDEX_M` | HNSW M 파라미터. |
| `KAIRO_VECTOR_INDEX_EF_CONSTRUCTION` | HNSW 빌드 파라미터. |
| `KAIRO_VECTOR_INDEX_EF_SEARCH` | HNSW 검색 파라미터. |

`KAIRO_VECTOR_INDEX_REBUILD=manual`일 때는 CLI `kairo-build-vector-index`를 사용하세요.

## 네이티브 검색(ADR-085)

Kairo의 file/doc 검색은 네이티브 모듈(`@kairo/core-rs`)을 통해 Tantivy로 동작합니다. 레거시 Trigram 인덱스는 제거되었습니다.

- ADR 요약: [ADR-085](/adr/ADR-085-rust-native-search-core-tantivy)
- 인덱스 디렉터리: `${KAIRO_DIR}/data/index[/repos/<repoId>]/v2-tantivy`
- 상태 점검: `manage({ command: "status" })` → `nativeSearch.available`, `nativeSearch.stats.docCount`, `nativeSearch.stats.writeEnabled`(writer lock으로 read-only면 false)
- 재빌드: `manage({ command: "reindex" })`

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_RUST_CORE_ENABLED` | Rust core(네이티브 검색 포함) 활성/비활성. | 기본 `true`. |

자세한 단계/명령은 아래 참고:

- [시작하기](/ko/guides/getting-started)
- [설정(전체 환경 변수)](/ko/guides/configuration)
