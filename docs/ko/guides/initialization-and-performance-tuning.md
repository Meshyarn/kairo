# 초기화 & 성능 튜닝

MCP 호스트에 연결하면 Kairo는 즉시 동작할 수 있지만, 인덱스와(선택) 프로젝트 로컬 설정 파일을 준비하면 성능과 안정성이 크게 좋아집니다.

**소요 시간:** 10–30분 | **난이도:** 중급

---

## Part A: 프로젝트 설정 부트스트랩(권장)

Kairo의 프로젝트 로컬 설정은 대상 프로젝트 루트의 `.kairo/config/` 아래에 위치합니다.

`manage` 도구로 starter skeleton을 생성하세요:

```bash
# 계획만 반환(파일을 쓰지 않음)
manage({ command: "init", mode: "plan" })

# `.kairo/config/*` 작성
manage({ command: "init", mode: "apply" })
```

대부분의 팀은 호스트 env를 과하게 늘리기보다, `.kairo/config/*`로 기본값을 관리하는 편이 좋습니다.

참고: [프로젝트 설정 파일](/ko/reference/configuration/project-files)

---

## Part B: 인덱스 구축(권장)

호스트 연결 후 한 번은 전체 리인덱스를 수행하세요:

```bash
manage({ command: "reindex" })
```

드리프트 복구나 대형 모노레포에서는 가능하면 타겟 리인덱스를 우선합니다:

```bash
manage({ command: "reindex", paths: ["src/index.ts", "packages/app/"] })
```

---

## Part C: 설정 검증

```bash
manage({ command: "status", detail: "summary" })
```

확인할 항목(고신호):

- `nativeSearch.available: true` (렉시컬 검색 활성화)
- `status.global.totalFiles` / `status.global.indexedFiles`가 저장소 규모에 맞는지
- `indexSnapshot.coverageRatio`가 리인덱스 이후 `1`에 가까운지
- `drift.workspaceDrift: "clean"` (첫 인덱싱 전에는 `"unknown"`일 수 있음)
- `symbolIndex.degradedReasons`에 `symbol_embeddings_not_built`가 있으면 임베딩/인덱스 설정에 맞게 빌드 필요

---

## Part D: 자주 쓰는 튜닝 포인트(최신)

### Preset & surface (권장)

`preset`, `publicSurface`, `budgets`, `timeboxMs` 같은 기본값은 `.kairo/config/mcp.json`에서 관리하는 것을 권장합니다.

참고:
- [MCP 모드 설정](/ko/reference/configuration/project-files)
- [예산(Budgets)](/ko/reference/configuration/budgets)

### 임베딩 & 벡터 인덱스(선택)

주요 env(자세한 내용은 레퍼런스 참조):

- `KAIRO_EMBEDDING_PROVIDER=auto|local|remote|disabled` (offline-first면 `local` 또는 `disabled`)
- `KAIRO_EMBEDDING_MODEL`, `KAIRO_EMBEDDING_PACK_FORMAT`, `KAIRO_VECTOR_INDEX`, `KAIRO_VECTOR_INDEX_REBUILD`, `KAIRO_VECTOR_INDEX_SHARDS`

참고:
- [검색 & 임베딩 설정](/ko/reference/configuration/search-and-embeddings)

### 저장소 경로(권장)

- `KAIRO_DIR`는 런타임 데이터 위치를 제어합니다(기본: 대상 프로젝트 루트의 `.kairo`).
- `KAIRO_STORAGE_MODE=file|memory`로 영속성을 제어합니다.

참고:
- [스토리지(Storage)](/ko/reference/configuration/storage)

### 로깅(MCP에서는 강력 권장)

stdout 프레이밍을 깨지 않도록 file logging을 권장합니다:

- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_LOG_DIR` / `KAIRO_LOG_FILE`로 경로 제어
- `KAIRO_ALLOW_STDOUT_LOGS=false`

참고:
- [로깅 & 텔레메트리](/ko/reference/configuration/logging-and-telemetry)

---

## 트러블슈팅(고신호)

### 네이티브 검색 불가

`nativeSearch.available`가 false면 네이티브 모듈을 빌드하세요:

```bash
npm run build:core-rs
```

### 인덱싱이 느리거나 타임아웃

- MCP 호스트 타임아웃을 늘리세요(호스트별 설정).
- 가능하면 `manage({ command: "reindex", paths: [...] })`로 부분 복구를 먼저 시도하세요.
- 임베딩을 켰다면 `KAIRO_EMBEDDING_*` / `KAIRO_VECTOR_INDEX_*`를 하드웨어에 맞게 튜닝하세요.

### 호스트에서 JSON 프레이밍 오류

아래를 확인하세요:

- `KAIRO_ALLOW_STDOUT_LOGS=false`
- `KAIRO_LOG_TO_FILE=true`

---

## Next

- [배포 시나리오](/ko/guides/deployment-scenarios)
- [시작하기](/ko/guides/getting-started)
- [검색 & 임베딩](/ko/guides/search-and-embeddings)

