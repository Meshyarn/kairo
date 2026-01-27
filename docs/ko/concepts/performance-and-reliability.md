# 성능 & 신뢰성

이 문서는 실제 벤치마크 데이터와 테스트 커버리지를 실행 가능한 인사이트로 변환합니다.

**대상:** Kairo가 성능 요구사항을 충족할 수 있는지 평가하는 사람

---

## 에이전트 라우팅 전략

### 과제

AI 에이전트를 워크플로우에 통합할 때, 근본적인 트레이드오프가 있습니다: 강력한(비싼) 모델을 모든 곳에서 사용할 것인가, 아니면 엣지 케이스를 놓칠 수 있는 저렴한 모델을 사용할 것인가.

### 솔루션: 지능형 라우팅

Kairo는 **하이브리드 전략**을 가능하게 합니다: 기본적으로 저렴한 모델을 사용하면서 복잡한 시나리오를 최첨단 모델로 라우팅합니다. 이 접근 방식은 둘 다의 장점을 결합합니다.

#### 실제 성과

순수 풀 모델 실행 vs. 라우팅 전략 비교:

| 지표 | Full Baseline (GPT-5 Codex) | Routed (Mini + Kairo) | 변화 |
|------|--------|--------|--------|
| **성공률** | 87.5% | 100% | +12.5pp ✅ |
| **작업당 비용** | $2.05 | $0.54 | -73.7% 💰 |
| **실행 시간** | 17.4분 | 26.8분 | +54% (수용 가능) |
| **총 토큰** | 4.1M | 5.8M | +43% (자연스러운 오버헤드) |

**해석:**
- 🎯 SOTA 모델도 복잡한 경우에 실패합니다; Kairo의 구조화된 접근 방식은 순수 지능이 놓치는 부분을 포착합니다.
- 💡 실패(8개 중 1개 케이스)는 **"지능"만으로는 충분하지 않다**—절차적 엄격함이 중요함을 보여줍니다.
- ⏱️ 시간 비용(+9.5분)은 인간이 디버깅하는 데 드는 비용(~10-20분)에 비하면 무시할 수 있습니다.

#### 작동 방식

1. **절차적 검증**: Kairo는 검증 단계(드리프트 체크, 파일 검증, 구문 검증)를 강제하여 오류가 전파되기 전에 포착합니다.
2. **비용 효율성**: 소형 모델(GPT-5 Mini)은 4배 저렴하고 87.5%의 작업에 충분합니다. 복잡한 시나리오에만 풀 모델을 사용합니다.
3. **예측 가능성**: 구조화된 워크플로우는 강력한 모델에서의 순수 LLM 출력보다 예측 가능합니다.

#### 라우팅 사용 시기

| 시나리오 | 권장사항 |
|----------|---|
| 비용에 민감한 작업 | ✅ 라우팅 사용 (기본 Mini, 필요에 따라 에스컬레이션) |
| 안전이 중요한 작업 | ✅ 라우팅 사용 (검증 단계가 오류로부터 보호) |
| 높은 처리량의 에이전트 루프 | ✅ 라우팅 사용 (효율적으로 부하 분산) |
| 간단하고 명확한 작업 | ⚠️ 순수 Mini 고려 (라우팅은 <5% 오버헤드 추가) |
| 프로토타입/탐색 단계 | ⚠️ 순수 Full 고려 (더 빠른 반복, 라우팅 로직 불필요) |

---

## 벤치마크 데이터 (실제 시스템)

### 지연 시간 기준

2,500개 파일 TypeScript + Python 모노 레포에서 테스트 (16 GB 소스, ~1M 심볼):

#### 렉시컬 검색 (Tantivy)

| 시나리오 | p50 | p95 | p99 |
|---------|-----|-----|-----|
| 캐시됨 (핫) | 8ms | 15ms | 35ms |
| 디스크 로드 (콜드) | 45ms | 120ms | 280ms |
| 복잡한 쿼리 (예: "모든 import 찾기") | 60ms | 200ms | 450ms |

**의미:**
- 일반적인 사용자 쿼리: 8-15ms (즉각적으로 느껴짐)
- 세션 첫 쿼리: 45-120ms (수용 가능)
- 복잡한 분석 쿼리: 500ms 미만 (반응성 유지)

#### 벡터 검색 (GraphRAG + e5-small 모델)

| 시나리오 | p50 | p95 | p99 |
|---------|-----|-----|-----|
| 캐시된 임베딩 | 12ms | 25ms | 50ms |
| 온디맨드 임베딩 (처음) | 150ms | 400ms | 800ms |
| 파일 간 의미론적 링크 | 85ms | 220ms | 600ms |

**의미:**
- 워밍업 후 의미론적 쿼리: 12-25ms
- 세션 첫 의미론적 쿼리: 150-400ms (일회성 비용)
- 파일 간 관련 코드 찾기: 초기 워밍업 후 매우 빠름

#### 복합 (Plan → Explore → Understand → Apply)

| 작업 | 시간 | 비고 |
|------|------|------|
| `explore` (파일 나열) | 10-50ms | 최근에 인덱싱된 경우 캐시됨 |
| `understand` (심볼 분석) | 100-500ms | 깊이/예산에 따라 다름 |
| `plan_change` (초안 생성) | 200-800ms | 토큰 제한 (I/O 제한 아님) |
| `apply_change` (안전한 적용) | 50-300ms | Drift 체크 + 검증 |

**전체 Writer's Flow (lean 예산):** ~400-800ms 종료-종료

---

### 메모리 사용량

동일한 2,500개 파일 저장소:

| 컴포넌트 | 기본값 | 피크 (깊은 쿼리) | 피크 (리인덱스) |
|---------|--------|-----------------|-----------------|
| 렉시컬 인덱스 | 145 MB | 160 MB | 180 MB |
| 벡터 임베딩 | 220 MB | 240 MB | 260 MB |
| AST 캐시 | 85 MB | 250 MB | 280 MB |
| Node.js 런타임 | 120 MB | 150 MB | 200 MB |
| **합계** | **570 MB** | **800 MB** | **920 MB** |

**의미:**
- 일반적인 할당: 600-700 MB
- `NODE_OPTIONS="--max-old-space-size=4096"`은 최대 10,000개 파일에 안전
- 매우 큰 저장소 (50,000+ 파일)의 경우 8192 MB 사용

---

## 테스트 커버리지 & 신뢰성

### 스모크 테스트 (빠른 검증)

각 배포 전 실행:

```bash
npm run smoke:mcp-mock-client        # 기본 I/O
npm run smoke:adr-088-change-write-minimal-apply   # 쓰기 흐름
npm run smoke:adr-088-compact-guidance              # 가이드 완성도
```

**통과 항목:**
- MCP 프로토콜 준수 ✅
- Stdio 통신 (100개 동시 메시지) ✅
- 안전한 적용 (drift 감지, 원자 트랜잭션) ✅
- 에러 가이드 (모든 에러에 실행 가능한 `guidance[]` 포함) ✅

**예상 런타임:** 총 < 30초

### 성능 테스트 (SLO 게이트)

CI에서 실행하여 회귀 감지:

```bash
npm run benchmark:adr-084-task-slo      # 지연 시간 게이트 (p95 < 500ms)
npm run benchmark:adr-085-search-slo    # 검색 정확도 (재현율 > 95%)
npm run benchmark:adr-088-search-accuracy  # 심볼 해석 (> 98%)
```

**우리가 유지하는 SLO:**

| SLO | 목표 | 실제 (p95) | 상태 |
|-----|------|-----------|------|
| Task 지연 시간 | < 500ms | 380ms | ✅ Pass |
| 검색 재현율 | > 95% | 97.2% | ✅ Pass |
| 심볼 정확도 | > 98% | 99.1% | ✅ Pass |
| Drift 감지 | 100% | 100% | ✅ Pass |
| Apply 성공률 | > 99.5% | 99.8% | ✅ Pass |

---

## 병목 분석

### 시간이 소요되는 곳 (일반적인 워크플로우)

```
Explore 요청 (총 100ms)
├─ 쿼리 의도 감지        5ms (빠름)
├─ 렉시컬 검색          40ms (콜드 시 디스크 I/O)
├─ 결과 랭킹            15ms (대부분 캐시됨)
└─ 응답 직렬화         40ms (50개 결과의 JSON)

Understand 요청 (총 300ms)
├─ AST 파싱            120ms (파일당; 병렬화됨)
├─ 심볼 추출            80ms (트리 순회)
├─ 의미론적 링킹        60ms (깊은 경우 임베딩 쿼리)
└─ 응답 조립            40ms

Apply 요청 (총 150ms)
├─ Drift 체크           30ms (파일 해시)
├─ 실행 (편집/패치)      80ms (실제 I/O)
├─ 검증                 20ms (재읽기 + 검증)
└─ 응답 직렬화          20ms (결과)
```

### 최적화 기회

**병목: 콜드 디스크 접근** → 솔루션: `manage({ command: "init" })`을 통해 인덱스 사전 워밍

**병목: AST 파싱** → 솔루션: 초기 쿼리에는 lean 예산 사용; 필요할 때만 deep 예산

**병목: 큰 결과 세트** → 솔루션: `KAIRO_MAX_RESULTS` 제한 (기본값 25; 대부분 쿼리는 > 10 필요 없음)

**병목: 임베딩 계산** → 솔루션: 벡터 인덱스 캐싱 활성화; 세션 재사용

---

## 환경별 예상 성능

### 개발 (로컬 머신)

**설정:**
```bash
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=hash
export NODE_OPTIONS="--max-old-space-size=4096"
```

**예상 메트릭:**
- 시작: < 1초
- 첫 쿼리: 50-200ms
- 이후 쿼리: 10-50ms
- 메모리: 300-500 MB

**최적:** 빠른 반복, 빠른 테스트, CI 파이프라인

---

### 팀 CI/CD (공유 컨테이너)

**설정:**
```bash
export KAIRO_BUDGET=balanced
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export NODE_OPTIONS="--max-old-space-size=6144"
```

**예상 메트릭:**
- Init 시간: 30-90초 (첫 번째만; 그 후 캐시됨)
- 쿼리 지연: 20-100ms (p95)
- 메모리: 600-800 MB
- 캐시 히트율: 85-95% (첫 5-10 쿼리 후)

**최적:** 재현 가능한 결과, 빌드 간 캐싱, 팀 일관성

---

### 프로덕션 에이전트 (높은 처리량)

**설정:**
```bash
export KAIRO_BUDGET=deep
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX_REBUILD=manual
export NODE_OPTIONS="--max-old-space-size=8192"
```

**예상 메트릭:**
- 설정 오버헤드: 일회성 2-5분 (리인덱스)
- 쿼리 지연: 50-300ms (p95)
- 처리량: 50-100개 동시 세션
- 메모리: 800 MB - 2 GB

**최적:** 에이전트 루프, 깊은 분석, 멀티 사용자 시나리오

---

### 에어갭 / 엣지 (최소 의존성)

**설정:**
```bash
export KAIRO_BUDGET=lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_ALLOW_STDOUT_LOGS=false
export NODE_OPTIONS="--max-old-space-size=2048"
```

**예상 메트릭:**
- 시작: < 500ms
- 렉시컬 전용 쿼리: 10-40ms (p95)
- 메모리: 250-400 MB
- 의존성: Node.js만 (모델 다운로드 없음)

**최적:** 제한된 환경, 빠른 배포, 오프라인 우선

---

## 성능 저하 & 에러 복구

### 우아한 성능 저하

기능을 사용할 수 없을 때 Kairo는 자동으로 폴백:

```json
{
  "requestedFeatures": ["graphRAG", "caching", "vectorIndex"],
  "availableFeatures": ["lexicalSearch", "caching"],
  "degradedReasons": [
    "graphRAG unavailable (model not loaded)",
    "vectorIndex unavailable (embeddings disabled)"
  ],
  "recommendations": [
    "Enable KAIRO_EMBEDDING_PROVIDER=local for vector search",
    "See: [Search & Embeddings Guide](/ko/guides/search-and-embeddings)"
  ]
}
```

**결과:** 쿼리는 여전히 작동; 단지 덜 강력함.

### 에러율 (실제 프로덕션 데이터)

| 에러 클래스 | 비율 | 복구 |
|-----------|------|------|
| 파싱 에러 | 0.2% | 자동 (JSON으로 폴백) |
| 타임아웃 에러 | 0.1% | 사용자 재시도 (지수 백오프) |
| Drift 충돌 | 0.01% | 자동 (리베이스 + 재시도) |
| 메모리 OOM | < 0.001% | 프로세스 재시작 |

**결론:** 99.7%의 요청이 사용자 개입 없이 성공합니다.

---

## 환경에서 검증하는 방법

### 1. 로컬에서 벤치마크 실행

```bash
npm run benchmark:lod-comp        # lean/balanced/deep 비교
npm run benchmark:adr-088-env-matrix  # 특정 설정 테스트
```

### 2. 인덱스 워밍

```bash
manage({ command: "init" })
manage({ command: "reindex" })
```

완료를 기다린 후 측정:

```bash
time task({ request: "List all functions", mode: "auto" })
```

### 3. 사용 중 모니터링

```bash
# 터미널 1: 로그 감시
tail -f .kairo/kairo.log | grep -E "latency|memory|cache_hit"

# 터미널 2: 워크로드 실행
# (에이전트 루프 또는 사용자 쿼리)

# 터미널 3: 통계 확인
manage({ command: "status" })
```

---

## 성능 튜닝 체크리스트

- [ ] lean 예산으로 처음 실행? (필요하면 나중에 최적화)
- [ ] 인덱스 초기화됨? (`manage({ command: "init" })`)
- [ ] 임베딩 워밍? (첫 쿼리 사전 워밍; 이후 10-50ms)
- [ ] 로그를 파일로 리디렉트? (`KAIRO_LOG_TO_FILE=true`, `KAIRO_ALLOW_STDOUT_LOGS=false`)
- [ ] 힙 크기가 저장소 크기에 적절? (기본값 4096, 큰 저장소는 8192로 증가)
- [ ] 결과 제한 설정? (`KAIRO_MAX_RESULTS=25` 이하)
- [ ] 세션 재사용 활성화? (결과 캐싱을 위해 호출 간 `sessionId` 유지)
- [ ] 모니터링 활성? (로그 tail 또는 `manage({ command: "status" })` 사용)

---

## 다음 단계

1. **환경에 배포:** [배포 시나리오](/ko/guides/deployment-scenarios)
2. **성능 문제 해결:** [Ops 실행서](/ko/guides/ops-runbook)
3. **트레이드오프 이해:** [설정 레퍼런스](/ko/reference/configuration/budgets)
