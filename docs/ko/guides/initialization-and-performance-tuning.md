# 초기화 & 성능 튜닝

MCP 호스트에 연결한 후, Kairo는 프로젝트를 초기화하고 선택적으로 성능 기능을 설정해야 합니다.

**소요 시간:** 15-30분 | **난이도:** 중급

---

## Part A: 프로젝트 초기화

### 초기화가 필요한 이유?

`manage({ command: "init" })`을 통한 초기화는 여러 중요한 작업을 수행합니다:

1. **`.kairo/` 디렉토리** 적절한 구조로 생성
2. **언어 설정 생성** (필요한 경우)
3. **렉시컬 검색을 위한 초기 인덱스** 구축
4. **임베딩/캐시 저장소** 설정
5. **프로젝트 구조 검증** 및 문제 보고

이를 건너뛰면 Kairo는 여전히 작동하지만:
- 첫 호출이 훨씬 느림 (온디맨드 인덱싱)
- 언어 감지 부정확
- 임베딩 캐싱 불가능

### 초기화 실행

#### MCP 호스트에서

```bash
# Claude CLI, Cline 또는 다른 에이전트에서:
manage({ command: "init" })
```

응답 (성공 시):

```json
{
  "success": true,
  "message": "Kairo initialized for /path/to/project",
  "details": {
    "languagesDetected": ["typescript", "python", "json"],
    "projectStructure": {
      "sourceFiles": 1234,
      "configFiles": 45,
      "testFiles": 89
    },
    "indexingStatus": "complete",
    "nextSteps": [
      "Configure embeddings (optional): KAIRO_EMBEDDING_PROVIDER=local",
      "Run performance profiling: manage({ command: 'status' })"
    ]
  }
}
```

#### CLI에서 (개발)

```bash
# Kairo를 로컬에서 실행 중인 경우
node dist/index.js --root /path/to/project

# 그 다음 stdio를 통해 전송:
echo '{"command":"manage","payload":{"command":"init"}}' | node dist/index.js --root /path/to/project
```

### 생성되는 항목

```
.kairo/
├── .kairo.lock          # 프로젝트 잠금 파일 (동시 접근 방지)
├── kairo.log            # 메인 로그 파일
├── storage/
│   ├── v1/
│   │   ├── index/       # 렉시컬 검색 인덱스
│   │   ├── embeddings/  # 벡터 임베딩 (활성화된 경우)
│   │   └── metadata/    # 인덱스 메타데이터
│   └── cache/           # 쿼리 결과 캐시
├── .mcp.json            # MCP 설정 (자동 생성 또는 수동)
├── language.json        # 언어 설정
└── state/               # 세션 및 트랜잭션 상태
```

---

## Part B: 성능 설정

초기화 후 성능 기능을 설정할 수 있습니다:

### 1. MCP 설정 (`.mcp.json`)

Kairo는 초기화 중에 `.kairo/.mcp.json`을 자동 생성하지만, 커스터마이징할 수 있습니다:

```json
{
  "version": "1.0",
  "profile": "balanced",
  "features": {
    "lexicalSearch": {
      "enabled": true,
      "provider": "tantivy"
    },
    "vectorSearch": {
      "enabled": true,
      "provider": "local",
      "model": "multilingual-e5-small"
    },
    "graphRAG": {
      "enabled": false,
      "depth": "standard"
    },
    "caching": {
      "enabled": true,
      "ttl": 3600
    }
  },
  "performance": {
    "maxConcurrency": 4,
    "timeoutMs": 300000,
    "budget": "balanced"
  },
  "logging": {
    "level": "info",
    "toFile": true,
    "toStdout": false
  }
}
```

**업데이트 프로세스:**

```bash
# 1. 현재 설정 확인
manage({ command: "status" })

# 2. .kairo/.mcp.json 수정 (텍스트 편집기)

# 3. 설정 다시 로드
manage({ command: "reindex" })
```

### 2. 언어 설정 (`language.json`)

Kairo는 초기화 중에 언어를 자동 감지하고 `.kairo/language.json`을 생성합니다:

```json
{
  "version": "1.0",
  "languages": [
    {
      "name": "typescript",
      "extensions": [".ts", ".tsx"],
      "parserOptions": {
        "parseComments": true,
        "extractSymbols": true
      }
    },
    {
      "name": "python",
      "extensions": [".py"],
      "parserOptions": {
        "parseDocstrings": true,
        "extractSymbols": true
      }
    }
  ],
  "fallback": "json"
}
```

**프로젝트에 맞게 커스터마이징:**

```bash
# 처음부터 생성
kairo-gen-languages --root /path/to/project > .kairo/language.json

# 또는 수동 편집 후 검증
manage({ 
  command: "status",
  detail: "full"
})
```

일반적인 커스터마이징:

| 시나리오 | 변경 사항 |
|---------|----------|
| 큰 TypeScript 모노 레포 | 파서 옵션에 `"maxDepth": 3` 추가 |
| Python + C 확장 | 두 파서 모두 추가; `.pyx` 확장자 확인 |
| 제한된 파싱 | 속도를 위해 `"parseComments": false` 설정 |
| 커스텀 파일 타입 | 가장 가까운 파서로 `languages[]`에 추가 |

### 3. GraphRAG 임베딩 설정

의미론적 검색 및 파일 간 의존성 이해 향상:

#### 사전 요구사항

- **HuggingFace 모델** (로컬 또는 원격)
- **임베딩 제공자** 설정됨 ([검색 & 임베딩](/ko/guides/search-and-embeddings) 참조)

#### GraphRAG 활성화

`.kairo/.mcp.json` 편집:

```json
{
  "features": {
    "graphRAG": {
      "enabled": true,
      "depth": "standard",
      "modelUrl": "Xenova/multilingual-e5-small"
    }
  }
}
```

그 다음 인덱스 재구축:

```bash
manage({ command: "reindex" })
```

이 작업을 수행합니다:
1. 각 심볼/파일에 대한 임베딩 계산
2. 벡터 인덱스 구축 (HNSW 또는 brute-force)
3. 파일 간 관련 심볼 링크
4. 빠른 쿼리를 위해 임베딩 캐시

**진행 상태 모니터링:**

```bash
# 실시간 로그 확인
tail -f .kairo/kairo.log | grep "graphrag\|embedding\|index"

# 또는 상태 확인
manage({ command: "status" })
```

### 4. 재구축 & 리인덱스

설정 변경 후 항상 리인덱스:

```bash
# 전체 재구축 (가장 느림; 모든 캐시 삭제)
manage({ command: "reindex" })

# 증분 리인덱스 (더 빠름; 변경된 것만)
manage({ command: "reindex", options: { mode: "incremental" } })

# 특정 언어만 재구축
manage({ command: "reindex", options: { language: "typescript" } })
```

**예상 시간:**

| 저장소 크기 | 렉시컬만 | + GraphRAG |
|-----------|---------|-----------|
| < 100 파일 | 5-10초 | 15-30초 |
| 100-1000 파일 | 30-60초 | 2-5분 |
| 1000-5000 파일 | 2-10분 | 10-30분 |
| 5000+ 파일 | 15-60분 | 45-180분 |

---

## Part C: 검증 & 성능 확인

초기화 후 설정을 검증합니다:

### 1. 프로젝트 구조 확인

```bash
manage({
  command: "status",
  detail: "full"
})
```

확인 사항:

```json
{
  "indexHealth": {
    "state": "healthy",
    "fileCount": 1234,
    "lastIndexTime": "2026-01-24T12:34:56Z",
    "staleness": "0s"
  },
  "languages": {
    "typescript": { "count": 800, "status": "indexed" },
    "python": { "count": 100, "status": "indexed" }
  },
  "features": {
    "lexicalSearch": "available",
    "vectorSearch": "available",
    "graphRAG": "ready"
  },
  "nativeCore": {
    "available": true,
    "version": "0.7.0"
  }
}
```

### 2. 테스트 검색 실행

```bash
task({
  request: "Find all authentication functions in the codebase",
  mode: "auto"
})
```

확인:
- 응답 시간 (캐시 p50 < 100ms, 콜드 < 1s)
- 결과 관련성 (상위 5개 결과가 실제로 관련 있음)
- 로그에 에러 없음

### 3. 리소스 사용량 모니터링

작업 중 메모리 및 CPU 확인:

```bash
# 터미널 1: 로그 감시
tail -f .kairo/kairo.log

# 터미널 2: 무거운 쿼리 실행
task({
  request: "Analyze cross-file dependencies",
  mode: "auto",
  budget: "deep"
})

# 터미널 3: 프로세스 모니터링
ps aux | grep node | grep kairo
```

정상 기준:
- RSS 메모리: 500 MB 미만 (소규모 프로젝트) ~ 2 GB (대규모)
- CPU: 인덱싱 중 스파이크, 그 다음 유휴
- 파일 디스크립터: < 256 (핸들 누수 없음을 나타냄)

---

## 빠른 설정 프로필

이를 시작점으로 사용합니다:

### 프로필: 개발 (빠른 반복)

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=hash
export KAIRO_ALLOW_STDOUT_LOGS=false
```

그 다음 초기화:

```bash
manage({ command: "init" })
```

**특징:** 최빠른 시작, 온디맨드 인덱싱, 의미론적 검색 없음.

### 프로필: 팀 CI/CD (안정적, 캐시 가능)

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=balanced
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_MODEL=multilingual-e5-small
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_LOG_TO_FILE=true
```

그 다음 초기화 및 재구축:

```bash
manage({ command: "init" })
manage({ command: "reindex" })
```

**특징:** 예측 가능한 성능, 전체 캐싱, 의미론적 검색 준비 완료.

### 프로필: 프로덕션 에이전트 (높은 처리량)

```bash
export KAIRO_MODE=mcp
export KAIRO_BUDGET=deep
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_VECTOR_INDEX_REBUILD=manual
export NODE_OPTIONS="--max-old-space-size=8192"
```

그 다음 초기화, 재구축 및 검증:

```bash
manage({ command: "init" })
manage({ command: "reindex" })
manage({ command: "status", detail: "full" })
```

**특징:** 깊은 분석, 지속적인 캐시, 에이전트 루프에 최적화.

---

## 문제 해결

### "Init failed: cannot write to .kairo/"

```bash
# 권한 확인
ls -la .kairo/

# 필요하면 수정
chmod 755 .kairo/
chmod 644 .kairo/*

# 재시도
manage({ command: "init" })
```

### "Index build took too long"

- MCP 설정에서 타임아웃 증가: `timeout: 600000`
- 또는 언어별로 분할: `manage({ command: "reindex", options: { language: "typescript" } })`
- 또는 증분 모드로 전환

### "graphRAG failed to initialize"

`.kairo/kairo.log` 확인:

```bash
tail -50 .kairo/kairo.log | grep -i "graphrag\|embedding"
```

일반적인 문제:
- 모델을 찾을 수 없음: `KAIRO_EMBEDDING_MODEL` 경로 확인
- 메모리 부족: `NODE_OPTIONS` 힙 크기 증가
- 언어 설정 누락: `language.json` 재생성

---

## 다음 단계

1. **첫 호출할 준비:** [첫 호출](/ko/quickstart/first-calls)
2. **더 깊은 성능 튜닝:** [배포 시나리오](/ko/guides/deployment-scenarios)에서 시나리오 확인
3. **임베딩 도움 필요:** [검색 & 임베딩](/ko/guides/search-and-embeddings)
