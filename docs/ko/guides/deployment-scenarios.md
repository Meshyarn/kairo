# 배포 시나리오

일반적인 환경별로 “바로 쓸 수 있는” 설정 프로필을 제공합니다. 기본은 `.kairo/config/*`로 관리하고, env는 최소만 유지하는 것을 권장합니다.

**대상:** Kairo를 프로덕션/팀 환경에 배포하는 사람

---

## 빠른 시나리오 선택

| 상황 | 섹션 참조 | 배포 시간 |
|---|---:|---:|
| 개발자, 로컬 머신 | 개발 | 5분 |
| 팀과 공유 CI/CD | 팀 CI/CD | 15분 |
| 에이전트 / AI 시스템 | 프로덕션 에이전트 | 20분 |
| 제한된 / 에어갭 환경 | 에어갭 | 10분 |
| 저사양/저메모리 | 리소스 제약 | 10분 |
| 멀티 테넌트 | 멀티 테넌트 | 30분 |

---

## 시나리오 1: 개발 (로컬 머신)

**목표:** 빠른 시작, 최소 설정, 안전한 MCP 기본값.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-lean
export KAIRO_EMBEDDING_PROVIDER=hash
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=15
export NODE_OPTIONS="--max-old-space-size=4096"
```

권장 흐름:

1) MCP 호스트에 Kairo(stdio)를 연결
2) (선택) `manage({ command: "init", mode: "apply" })`로 `.kairo/config/*` 작성
3) `manage({ command: "reindex" })` 1회 수행 후 반복 작업

---

## 시나리오 2: 팀 CI/CD (공유 컨테이너 / 빌드 시스템)

**목표:** 기계 간 일관성, 캐시 영속화, 재현 가능한 인덱싱.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-balanced
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_MODEL=multilingual-e5-small
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_VECTOR_INDEX_REBUILD=manual
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=20
export NODE_OPTIONS="--max-old-space-size=6144"
```

캐시 전략:

- 대상 프로젝트의 `.kairo/` 디렉터리를 CI 실행 사이에 보존하세요(artifact 또는 persistent volume).
- 입력(소스/의존성/임베딩 설정)이 바뀌지 않았으면 `reindex`를 매번 할 필요는 없습니다.

호스트 없이 부트스트랩(참고):

- 임의의 MCP 클라이언트(SDK)로 Kairo에 `manage` 호출을 보내면 됩니다.
- 이 레포에는 참고용 클라이언트가 포함되어 있습니다(필요 시 확장):

```bash
npm run build
KAIRO_STORAGE_MODE=file node scripts/mock-mcp-client.mjs --root /path/to/project
```

---

## 시나리오 3: 프로덕션 에이전트 (높은 처리량)

**목표:** 깊은 분석, 예측 가능한 지연, 관측 가능성 강화.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-deep
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_VECTOR_INDEX_REBUILD=manual
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=25
export KAIRO_TOOL_SCHEMA_MODE=compat
export NODE_OPTIONS="--max-old-space-size=8192"
```

운영 체크리스트:

- 주기적으로 `manage({ command: "status", detail: "full" })`를 수집하세요.
- `drift.workspaceDrift`를 모니터링하고, 가능하면 `paths` 기반 부분 리인덱스로 복구하세요.
- stdout는 MCP 프레임 전용으로 유지하고, 파일 로그를 사용하세요(`KAIRO_LOG_TO_FILE=true` + `KAIRO_LOG_DIR`/`KAIRO_LOG_FILE`).

---

## 시나리오 4: 에어갭 / 제한된 환경

**목표:** 런타임 외부 다운로드 0, offline-first.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=10
export NODE_OPTIONS="--max-old-space-size=2048"
```

메모:

- 모델/자산을 로컬로 번들하지 않는다면 임베딩은 꺼 두는 편이 안전합니다.
- stdout 로그가 MCP 스트림을 오염시키지 않도록(호스트 설정 포함) 반드시 확인하세요.

---

## 시나리오 5: 리소스 제약 (엣지 / 저메모리)

**목표:** 최소 메모리 풋프린트, 빠른 콜드 스타트.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_LOG_TO_FILE=false
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=5
export NODE_OPTIONS="--max-old-space-size=1024"
```

팁:

- 렉시컬 중심 워크플로우를 권장합니다(`KAIRO_EMBEDDING_PROVIDER=disabled`).
- 응답 크기를 줄이세요(`KAIRO_MAX_RESULTS` 감소, 호출 시 `limits.maxTokens` / `limits.maxChars` 사용).

---

## 시나리오 6: 멀티 테넌트 (고급)

**목표:** 테넌트별 런타임 데이터/로그 분리, 교차 드리프트 방지.

테넌트별:

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-balanced
export KAIRO_ROOT_PATH=/data/tenants/${TENANT_ID}/codebase
export KAIRO_DIR=/data/tenants/${TENANT_ID}/.kairo
export KAIRO_LOG_TO_FILE=true
export KAIRO_LOG_DIR=/data/tenants/${TENANT_ID}/logs/kairo
export KAIRO_TOOL_SCHEMA_MODE=compat
export KAIRO_MAX_RESULTS=20
export NODE_OPTIONS="--max-old-space-size=2048"
```

리소스 제한:

- 메모리/CPU는 컨테이너/OS 레벨 제한을 사용하세요.
- 요청 타임아웃은 MCP 호스트(요청 단위)를 사용하세요.
- 서버 측 best-effort 상한은 `.kairo/config/mcp.json`의 `timeboxMs`로 설정할 수 있습니다.

---

## 비교표(요약)

| 항목 | Dev | Team CI/CD | Prod Agent | Air-gapped | Resource-limited |
|---|---|---|---|---|---|
| Preset | `mcp-lean` | `mcp-balanced` | `mcp-deep` | `mcp-lean` | `mcp-lean` |
| 임베딩 | `hash` | `local` | `local` | `disabled` | `disabled` |
| 캐시 영속화 | 선택 | 예 | 예 | 선택 | 아니오 |
| 최적 | 반복 | 일관성 | 확장 | 컴플라이언스 | 효율 |

---

## Next

- [프로젝트 설정 파일](/ko/reference/configuration/project-files)
- [로깅 & 텔레메트리](/ko/reference/configuration/logging-and-telemetry)
- [성능 & 신뢰성](/ko/concepts/performance-and-reliability)

