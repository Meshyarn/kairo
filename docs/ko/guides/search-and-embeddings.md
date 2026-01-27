# 검색 & 임베딩(offline-first)

이 가이드는 Kairo의 검색(렉시컬 + 선택적 벡터 검색)이 어떻게 동작하는지, 그리고 임베딩 스택을 **오프라인 우선**으로 운영하는 방법을 다룹니다.

환경 변수(설정)만 빠르게 확인하려면:

- [검색 & 임베딩 설정](/ko/reference/configuration/search-and-embeddings)

## 멘탈 모델

Kairo는 검색을 두 레이어로 구성합니다:

- **렉시컬 검색**(빠르고 안정적): 네이티브 코어(`@kairo/core-rs` / Tantivy) 기반
- **벡터 검색**(시맨틱): 선택 기능(임베딩 + (선택) 벡터 인덱스 필요)

오프라인 베이스라인:

- **Baseline-A(core)**: 임베딩이 `hash`/`disabled`여도 네트워크 없이 동작
- **Baseline-B(embeddings-ready)**: 로컬 모델 파일이 준비되어 오프라인 벡터 검색 가능

## 임베딩 포지션 선택

| 목표 | 추천 포지션 | 비고 |
|---|---|---|
| "모델 파일 없이 어디서나" | `KAIRO_EMBEDDING_PROVIDER=hash` | 마찰 최소, 시맨틱 품질은 제한적 |
| "오프라인 고정 + 기본값" | `KAIRO_EMBEDDING_PROVIDER=local` | 로컬 모델 자산 필요 |
| "런타임 다운로드 허용" | `KAIRO_EMBEDDING_PROVIDER=remote` | 명시적 opt-in, 네트워크 정책에 의존 |
| "벡터 완전 비활성" | `KAIRO_EMBEDDING_PROVIDER=disabled` | 렉시컬만 사용 |

### 기본값 선택의 이유

- **`hash` (dev 기본)**: 테스트에 가장 실용적. 임베딩 없이 캐싱 가능.
- **`local` (권장, 프로덕션)**: 오프라인 가능하고 예측 가능. 미리 모델 패키징 계획.
- **`disabled`**: 엄격한 에어갭 환경에서 가장 안전. 렉시컬만 ~80% 커버.


## 로컬 임베딩 모델 준비(오프라인)

Kairo는 기본적으로 offline-first 입니다. 런타임 다운로드는 `KAIRO_EMBEDDING_PROVIDER=remote`로 명시적으로 opt-in 하지 않는 한 비활성입니다.

권장 소스: `Xenova/multilingual-e5-small` (ONNX + tokenizer 파일; `@xenova/transformers` 호환).

### HuggingFace CLI 설치 (필요한 경우)

`huggingface-cli`가 없으면 먼저 설치하세요:

```bash
# pip 사용
pip install huggingface-hub

# npm 사용 (Node.js 선호 시)
npm install -g huggingface-hub
```

설치 확인:
```bash
huggingface-cli --version
```

### 모델 다운로드

인터넷이 되는 머신에서:

```bash
huggingface-cli download Xenova/multilingual-e5-small \
  --local-dir /tmp/models/multilingual-e5-small \
  --local-dir-use-symlinks false
```

이 명령은 ~350MB의 모델 파일을 다운로드합니다.


오프라인 머신으로 폴더를 복사하세요. 디렉터리는 아래 형태여야 합니다:

```
models/
  multilingual-e5-small/
    config.json
    tokenizer.json
    tokenizer_config.json
    special_tokens_map.json    (optional)
    onnx/
      model.onnx
      model_quantized.onnx     (recommended)
```

메모:

- 폴더 이름은 `KAIRO_EMBEDDING_MODEL`(기본: `multilingual-e5-small`)과 일치해야 합니다.
- 다른 모델을 쓰면 ONNX + tokenizer 자산(`@xenova/transformers` 호환)이 필요합니다.

## 릴리즈 아티팩트에 오프라인 모델 번들링

릴리즈 아티팩트를 만들 때 로컬 모델을 `dist/models`에 번들링합니다:

```bash
# 로컬 모델 폴더를 가리키세요(모델 루트 또는 그 상위)
KAIRO_MODEL_SOURCE=/path/to/models \
KAIRO_EMBEDDING_MODEL=multilingual-e5-small \
npm run bundle:models
```

메모:

- 기본은 **minimal** 프로파일(필수 tokenizer/config + ONNX 1개)입니다.
  모든 변형을 포함하려면 `KAIRO_MODEL_BUNDLE_PROFILE=full`.
- `npm pack` / `npm publish`는 `prepack`에서 자동 번들링합니다.
- `KAIRO_SKIP_MODEL_BUNDLE=true`는 dev-only로 번들링을 스킵합니다.

## 벡터 검색 활성화

시맨틱 리콜이 중요할 때(유사 패턴, 개념 레벨 탐색 등) 벡터 검색을 켜는 것이 유리합니다.

### 핵심 설정 설명

| 설정 | 기본값 | 이유 |
|------|--------|------|
| `KAIRO_EMBEDDING_PROVIDER` | `hash` | `hash`는 빠르고 셋업 없음. 시맨틱 필요할 때 `local`로 업그레이드. |
| `KAIRO_EMBEDDING_MODEL` | `multilingual-e5-small` | 작음(~350MB), 다국어, 오프라인. 속도 vs 품질 좋은 균형. |
| `KAIRO_MODEL_DIR` | `./models` (root 상대) | 각 프로젝트가 자체 모델 보유 가능, 충돌 없음. |
| `KAIRO_VECTOR_INDEX` | `auto` | 미리빌드 인덱스 없으면 brute-force. 큰 저장소는 `hnsw` + `KAIRO_VECTOR_INDEX_REBUILD=manual`. |

전체 레퍼런스: [검색 & 임베딩 설정](/ko/reference/configuration/search-and-embeddings)


## 임베딩 pack 빌드

대형 저장소에서는 임베딩을 바이너리 pack으로 저장하면 복원 시간과 디스크 사용량을 줄일 수 있습니다.

```bash
# float32 (안전한 기본값)
KAIRO_EMBEDDING_PACK_FORMAT=float32 \
kairo-migrate-embeddings-pack

# 또는 float32 + q8 둘 다 저장
KAIRO_EMBEDDING_PACK_FORMAT=both \
kairo-migrate-embeddings-pack
```

메모:

- 기존 pack을 덮어쓰려면 `--force`.
- pack 파일은 `.kairo/storage/v1/embeddings/<provider>/<model>/` 아래에 저장됩니다.
- 매우 큰 pack은 `KAIRO_EMBEDDING_PACK_INDEX=bin`을 고려하세요(바이너리 인덱스).
- 시작 시 자동 마이그레이션은 `KAIRO_EMBEDDING_PACK_REBUILD=auto`(강제는 `on_start`).

## 벡터 인덱스 빌드

ANN을 켰고 시작 시 재빌드를 피하고 싶다면, 벡터 인덱스를 한 번 생성하세요:

```bash
KAIRO_VECTOR_INDEX=hnsw \
KAIRO_VECTOR_INDEX_REBUILD=manual \
kairo-build-vector-index
```

메모:

- 대형 저장소는 샤딩을 고려하세요: `KAIRO_VECTOR_INDEX_SHARDS=auto` (또는 `4` 같은 숫자).
- `KAIRO_VECTOR_INDEX=auto`(기본값)는 인덱스가 없으면 brute-force로 폴백합니다.
- 인덱스는 `.kairo/vector-index/<provider>/<model>/` 아래에 저장됩니다.

## 트러블슈팅

- 렉시컬 검색이 없거나 느리면 네이티브 코어 상태를 확인하세요:
  - `CAP_NATIVE_SEARCH_UNAVAILABLE` → `npm run build:core-rs`로 네이티브 코어 빌드 후 재시도
  - `manage({ command: "status" })` → `nativeSearch.available` 확인
- 임베딩을 못 찾으면:
  - `KAIRO_EMBEDDING_MODEL`이 폴더명과 일치하는지
  - `KAIRO_MODEL_DIR`이 모델 폴더를 포함하는 디렉터리를 가리키는지 확인
- 호스트에서 “랜덤 파싱 오류”가 나면:
  - stdout 청결 유지(`KAIRO_ALLOW_STDOUT_LOGS=false`, file logging 활성화)
