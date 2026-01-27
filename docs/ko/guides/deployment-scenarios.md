# 배포 시나리오

일반적인 사용 사례를 위한 실제 설정 프로필. 시나리오를 선택하고 환경 변수를 적용한 후 필요에 따라 커스터마이징하세요.

**대상:** Kairo를 프로덕션이나 팀 환경에 배포하는 사람

---

## 빠른 시나리오 선택

| 상황 | 섹션 참조 | 배포 시간 |
|------|---------|---------|
| 개발자, 로컬 머신 | 개발 | 5분 |
| 팀과 공유 CI/CD | 팀 CI/CD | 15분 |
| 에이전트 / AI 시스템 | 프로덕션 에이전트 | 20분 |
| 제한된 / 에어갭 환경 | 에어갭 | 10분 |
| 리소스 제약 환경 | 리소스 제약 | 10분 |

---

## 시나리오 1: 개발 (로컬 머신)

**대상:** 개발자, 빠른 반복, 빠른 피드백.

**목표:**
- 최빠른 시작
- 최소 설정
- 온디맨드 인덱싱 (사전 워밍 불필요)
- 지속적 캐시 신경 안 쓰기

### 환경 변수

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=hash
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_LOG_TO_FILE=true
export KAIRO_MAX_RESULTS=15
export NODE_OPTIONS="--max-old-space-size=4096"
```

### 설정 단계

```bash
# 1. 설치
npm install kairo

# 2. 빠른 스모크 테스트
npm run smoke:mcp-mock-client

# 3. 편집기/IDE에 연결
# (Claude/.cline/etc.에서 MCP 설정 — npm-install-and-setup.md 참조)

# 4. 첫 호출
task({ request: "List all TypeScript files", mode: "auto" })
```

### 예상 동작

- **첫 호출:** 50-200ms (콜드 인덱스)
- **이후 호출:** 10-50ms (캐시됨)
- **메모리:** 300-500 MB
- **디스크:** 최소 (.kairo/ ~50 MB)

### 업그레이드 시기

- 팀과 코드 공유 중 → **팀 CI/CD**로 전환
- 프로젝트가 5,000개 파일 이상 → **프로덕션 에이전트**로 전환 (임베딩 워밍 추가)
- 의미론적 검색 원함 → `KAIRO_EMBEDDING_PROVIDER=local` 추가

---

## 시나리오 2: 팀 CI/CD (공유 컨테이너/빌드 시스템)

**대상:** DevOps, 플랫폼 팀, 공유 인프라, 재현 가능한 빌드.

**목표:**
- 기계 간 일관된 동작
- 지속적 캐시 (빌드 간)
- 전체 검색 기능 (렉시컬 + 의미론적)
- 예측 가능한 성능

### 환경 변수

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=balanced
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

### 설정 단계

```bash
# 1. CI 이미지에 설치 (Dockerfile 또는 유사)
RUN npm install kairo

# 2. 설정 단계에서 초기화
npm run kairo-init -- --root /path/to/project

# 3. 인덱스 구축 (일회성, 캐시됨)
npm run kairo-reindex

# 4. CI 워크플로우에서:
# - .kairo/을 아티팩트로 저장 (또는 지속적 볼륨)
# - 각 빌드마다: .kairo/ 복구 → init 건너뛰기 → 캐시 사용

# 예: GitHub Actions:
- name: Restore Kairo cache
  uses: actions/cache@v3
  with:
    path: .kairo
    key: kairo-${{ hashFiles('package.json') }}

- name: Initialize Kairo (첫 번째만)
  run: npm run kairo-init

- name: CI 작업
  run: npm run your-ci-job
```

### 예상 동작

- **첫 빌드:** 30-90초 (초기화 + 인덱싱)
- **캐시된 빌드:** < 1초 (.kairo/ 복구)
- **쿼리 지연:** 20-100ms (p95)
- **메모리:** 600-800 MB
- **캐시 히트율:** 85-95% (첫 몇 쿼리 후)

### 비용 절약 팁

`.kairo/.mcp.json`을 사용하여 비용이 많이 드는 기능 선택적 비활성화:

```json
{
  "features": {
    "graphRAG": {
      "enabled": false  // 불필요하면 건너뛰기
    }
  }
}
```

그 다음 리인덱스:

```bash
manage({ command: "reindex" })
```

---

## 시나리오 3: 프로덕션 에이전트 (높은 처리량)

**대상:** AI 에이전트, 자율적 코드 수정, 높은 동시성 시나리오.

**목표:**
- 코드베이스의 깊은 이해
- 빠른 응답 (여러 에이전트 병렬 쿼리)
- 신뢰할 수 있는 에러 처리
- 성능 지속적 모니터링

### 환경 변수

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=deep
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_VECTOR_INDEX_REBUILD=manual
export KAIRO_VECTOR_INDEX_SHARDS=auto
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=25
export KAIRO_TOOL_SCHEMA_MODE=compat
export NODE_OPTIONS="--max-old-space-size=8192"
```

### 설정 단계

```bash
# 1. 컨테이너 배포
docker run \
  --env-file .env.prod \
  --volume /path/to/codebase:/code \
  --volume /path/to/cache:/cache \
  my-kairo-image

# Dockerfile에서:
FROM node:18-alpine

WORKDIR /app
COPY package.json .
RUN npm ci

# 인덱스 사전 구축 (일회성)
RUN npm run kairo-init -- --root /code
RUN npm run kairo-reindex

ENTRYPOINT ["node", "dist/index.js", "--root", "/code"]
```

### 모니터링 & 튜닝

```bash
# 정기적으로 상태 확인
manage({
  command: "status",
  detail: "full"
})

# 성능 모니터링
manage({
  command: "status",
  include: ["performance", "cacheStats", "memoryUsage"]
})

# 응답 예시:
# {
#   "performance": {
#     "avgLatency": "85ms",
#     "p95Latency": "250ms",
#     "cacheHitRate": "92%"
#   },
#   "memoryUsage": {
#     "rss": "1.8GB",
#     "heapUsed": "1.2GB"
#   }
# }
```

### 성능 튜닝

높은 지연 시간이 보이면:

```bash
# 느린 항목 확인
manage({ command: "status", include: ["slowQueries"] })

# 1. 병목이 벡터 검색인 경우:
export KAIRO_VECTOR_INDEX_SHARDS=4  # 더 많은 샤드 = 빠른 인덱싱

# 2. 병목이 임베딩 계산인 경우:
# 광범위한 쿼리로 사전 워밍
task({ request: "Summarize codebase structure", budget: "deep" })

# 3. 메모리가 높은 경우:
# 배치 크기 감소
export KAIRO_EMBEDDING_PACK_INDEX=bin  # 바이너리 포맷 사용
```

### 예상 동작

- **설정:** 일회성 2-5분 (사전 인덱싱)
- **쿼리 지연:** 50-300ms (p95)
- **처리량:** 50-100개 동시 세션
- **메모리:** 800 MB - 2 GB (프로젝트 크기에 따라)

---

## 시나리오 4: 에어갭 / 제한된 환경

**대상:** 금융, 의료, 정부 부문 (엄격한 보안 정책).

**목표:**
- 외부 다운로드 없음
- 최소 의존성
- 오프라인 우선 작동
- 규정 준수 친화적

### 환경 변수

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_LOG_TO_FILE=true
export KAIRO_MAX_RESULTS=10
export NODE_OPTIONS="--max-old-space-size=2048"
# 네트워크 호출 없음; 모델 다운로드 없음
```

### 설정 단계

```bash
# 1. 인터넷 있는 머신에서 (에어갭 준비):
npm install kairo
# (Node.js 의존성만 다운로드)

# 2. 모든 것을 번들화
tar -czf kairo-bundle.tar.gz node_modules/ dist/

# 3. 에어갭 환경으로 전송 (USB, 승인된 채널)

# 4. 압축 해제 및 초기화
tar -xzf kairo-bundle.tar.gz
node dist/index.js --root /path/to/project

# 5. 첫 init 호출
manage({ command: "init" })
```

### 검증 체크리스트

```bash
# 외부 접근 시도 없음 확인:
strace -e connect node dist/index.js --root /path 2>&1 | grep -v "unix\|127.0"
# 표시되는 것: 없음 (외부 연결 없음)

# 렉시컬 전용 검색 작동 확인:
task({
  request: "Find all error handlers",
  mode: "auto"
})
# 임베딩 없이 성공해야 함

# 상태 확인:
manage({ command: "status" })
# "vectorSearch": "unavailable" (예상됨)
# "lexicalSearch": "available" (필수)
```

### 예상 동작

- **시작:** < 500ms
- **렉시컬 쿼리:** 10-40ms (p95)
- **메모리:** 250-400 MB
- **디스크:** ~20 MB (.kairo/ 인덱스)
- **네트워크 요청:** 0

---

## 시나리오 5: 리소스 제약 (엣지 / 임베디드)

**대상:** 임베디드 시스템, 서버리스 (콜드 스타트 민감), 저메모리 환경.

**목표:**
- 최소 메모리 풋프린트
- 빠른 콜드 스타트
- 낮은 CPU 사용량
- 엣지 디바이스에서 작동

### 환경 변수

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_LOG_TO_FILE=false  # 파일 I/O 오버헤드 건너뛰기
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=5  # 작은 결과 세트
export NODE_OPTIONS="--max-old-space-size=1024"  # 최대 1 GB
```

### 배포 프로필

```bash
# AWS Lambda / 유사 서비스의 경우:
HANDLER_MEMORY=512MB  # 또는 필요하면 더 높음
TIMEOUT=60s

# Raspberry Pi / 유사 환경의 경우:
# 최소 2 GB 여유 RAM 확인
# .kairo/ 저장소는 SSD 권장 (SD 카드 아님)
```

### 최적화 팁

```bash
# 1. 불필요한 기능 비활성화
export KAIRO_PARSING_DEPTH=1  # 표면 레벨 심볼만

# 2. 동시성 제한
export KAIRO_MAX_CONCURRENT_OPS=1

# 3. 최소 로깅 사용
export KAIRO_LOG_LEVEL=error  # 에러만

# 4. 특정 워크로드 프로파일
time task({ request: "Your typical query", mode: "auto" })
```

### 예상 동작

- **콜드 스타트:** 300-500ms
- **웜 호출 지연:** 50-150ms
- **메모리:** 200-300 MB
- **적합:** 쿼리만 (인덱싱 아님)

---

## 시나리오 6: 커스텀 멀티 테넌트 (고급)

**대상:** 플랫폼 팀, SaaS 제공자, 멀티 사용자 시나리오.

**목표:**
- 프로젝트 격리
- 프로젝트별 설정
- 테넌트당 리소스 제한
- 감사 로깅

### 환경 변수 (테넌트당)

```bash
# 각 테넌트는 고유 환경을 얻습니다
export KAIRO_MODE=mcp
export KAIRO_BUDGET=balanced
export KAIRO_ROOT_PATH=/data/tenants/${TENANT_ID}/codebase
export KAIRO_LOG_TO_FILE=true
export KAIRO_LOG_PATH=/data/tenants/${TENANT_ID}/logs/kairo.log
export KAIRO_TOOL_SCHEMA_MODE=compat
export KAIRO_MAX_RESULTS=20
export NODE_OPTIONS="--max-old-space-size=2048"
```

### 멀티 테넌트 설정

```bash
# Docker Compose 예시
version: '3.8'
services:
  kairo-tenant-1:
    image: my-kairo:latest
    environment:
      TENANT_ID: customer-a
      KAIRO_ROOT_PATH: /projects/customer-a
    volumes:
      - ./projects/customer-a:/projects/customer-a
      - ./cache/customer-a/.kairo:/.kairo

  kairo-tenant-2:
    image: my-kairo:latest
    environment:
      TENANT_ID: customer-b
      KAIRO_ROOT_PATH: /projects/customer-b
    volumes:
      - ./projects/customer-b:/projects/customer-b
      - ./cache/customer-b/.kairo:/.kairo
```

### 리소스 제한

```bash
# 한 테넌트가 다른 테넌트를 빼앗지 않도록 방지
KAIRO_MEMORY_LIMIT=2048MB  # 테넌트당
KAIRO_TIMEOUT=30000ms      # 요청당
KAIRO_MAX_CONCURRENT_REQUESTS=5  # 테넌트당

# 각 테넌트 모니터링
for tenant in customer-{a,b,c}; do
  echo "=== $tenant ==="
  manage({
    command: "status",
    detail: "full"
  }) | jq .memoryUsage
done
```

---

## 비교 테이블

| 측면 | 개발 | 팀 CI/CD | 프로드 에이전트 | 에어갭 | 리소스 제약 |
|------|-----|---------|-------------|--------|-----------|
| 설정 시간 | 5분 | 15분 | 20분 | 10분 | 10분 |
| 예산 | lean | balanced | deep | lean | lean |
| 임베딩 | hash | local | local | disabled | disabled |
| 메모리 | 300-500 MB | 600-800 MB | 800-2000 MB | 250-400 MB | 200-300 MB |
| 지연 (p95) | 50-200ms | 20-100ms | 50-300ms | 10-40ms | 50-150ms |
| 캐시 지속성 | 없음 | 예 | 예 | 없음 | 없음 |
| 최적 | 반복 | 신뢰성 | 규모 | 보안 | 효율성 |

---

## 마이그레이션 경로

**간단하게 시작, 필요할 때 확장:**

1. **개발**로 시작 (최빠른 생산성)
2. 팀원 추가 → **팀 CI/CD**로 마이그레이션 (캐싱 + 일관성)
3. 프로덕션 진행 → **프로덕션 에이전트** (깊은 분석 + 모니터링)
4. 규정 준수 필요 → **에어갭 기능** 추가
5. 엣지에서 실행 → **리소스 제약**

---

## 시나리오별 문제 해결

### "개발 설정이 느려요"
→ 임베딩 건너뛰기: `KAIRO_EMBEDDING_PROVIDER=disabled`

### "CI 빌드가 일관성이 없어요"
→ **팀 CI/CD** 사용: 빌드 간 .kairo/ 캐시

### "에이전트 쿼리가 타임아웃돼요"
→ MCP 설정에서 타임아웃 증가: `timeout: 600000`

### "외부 모델 URL에 접근할 수 없어요"
→ **에어갭** 사용: `KAIRO_EMBEDDING_PROVIDER=disabled`

### "메모리 부족 에러"
→ 예산 감소: `KAIRO_BUDGET=lean`

---

## 다음 단계

1. **시나리오 선택** 및 환경 변수 적용
2. **초기화:** `manage({ command: "init" })`
3. **테스트:** `task({ request: "Your first query", mode: "auto" })`
4. **모니터링:** `manage({ command: "status", detail: "full" })`
5. **필요하면 튜닝:** [성능 & 신뢰성](/ko/concepts/performance-and-reliability) 확인

자세한 참고는 [설정 레퍼런스](/ko/reference/configuration/basics)를 보세요.
