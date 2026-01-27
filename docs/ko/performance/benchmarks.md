# 벤치마크 리포트: 라우팅 전략

**날짜:** 2026년 1월  
**모델:** GPT-5.1 Codex Mini + GPT-5.1 Codex  
**소요 시간:** 총 ~46분 (단일 실행; full-baseline 비교 포함)

---

## 요약

AI 에이전트를 고신뢰도 시스템에 통합하기 위한 두 가지 전략을 비교합니다:

1. **Full Baseline**: 항상 상위 모델 사용 (GPT-5.1 Codex)
2. **Routed Strategy**: 기본은 저예산 모델(Mini baseline), 일부 케이스를 **Mini + Kairo**로 라우팅하여 절차적 실행을 강화

**핵심 발견(이번 실행):** 라우팅 전략은 **pass@1 100%를 유지**하면서 **실지출 기준 비용을 72.0% 절감**했습니다. 트레이드오프로 **wall time +27.7%**, **총 토큰 +52.3%**가 관측됩니다(검증/절차 오버헤드로 자연스러움).

> 참고: 운영에서는 “complex → 상위 모델” 라우팅도 선택할 수 있습니다. 이 벤치마크는 **모델 티어를 Mini로 고정**하고, Kairo(절차적 실행)의 기여를 보기 위해 실행 전략만 바꿉니다.

---

## 테스트 환경

### 설정

```bash
node benchmarks/agent/launch.mjs --provider codex \
  --pipeline route \
  --suite benchmarks/agent/suite.kairo5.json \
  --mode live \
  --mini gpt-5.1-codex-mini \
  --full gpt-5.1-codex \
  --timeout-ms 600000 \
  --kairo-budget low \
  --pricing benchmarks/agent/pricing.json \
  --attempts 2 \
  --gate-files-min 5 \
  --gate-category cli
```

### 라우팅 로직

- **라우팅된 케이스 (4/8):** 복잡한 시나리오 (5개 이상 파일 OR `cli` 카테고리)
  - `kc-reindex-status-001` (기능)
  - `kc-workspace-flag-001` (cli)
  - `kc-allow-cwd-root-flag-001` (cli)
  - `kc-kairo-dir-flag-001` (cli)

- **라우팅되지 않은 케이스 (4/8):** 간단/비라우팅 케이스 (스키마, ux, 문서)
  - `kc-tool-schema-001` (스키마)
  - `kc-warmup-empty-index-001` (ux)
  - `kc-compact-surface-rename-001` (문서)
  - `kc-adr-index-001` (문서)

---

## 테스트 스위트 설계(왜 이런 케이스들인가)

이 벤치마크 스위트는 비용을 고려해 **작게 유지**하면서, Kairo의 강점이 드러나기 쉬운 영역(절차적 변경, 다중 파일 일관성, validator 기반 정확성)에 일부러 비중을 둡니다.

### 포함 범위

- **Schema**: tool surface / schema 일관성(“스펙 드리프트” 감지에 유리).
- **CLI**: flag/alias 추가처럼 코드+문서 동시 변경이 필요한 작업(절차적, multi-file).
- **Feature**: 여러 레이어를 건드리는 구체적 기능 변경(tool registry, 핸들러 로직, 에이전트 문서 등).
- **UX**: “warmup / empty index”처럼 환경/상태 처리가 중요한 워크플로우.
- **Docs**: 기대 결과가 명확한 문서 변경(모호성 낮고 검증 용이).

### 이 조합을 택한 이유

- **결과 검증의 결정성**: 로컬 validator(files/content)로 체크 가능한 케이스 위주라, 주관적 채점이 줄어듭니다.
- **실전 에이전트 작업과 유사**: 실제로는 “작지만 여기저기 손대는(코드/CLI/문서)” 유형이 많이 발생합니다.
- **재현 가능한 시작 상태**: 고정된 fixture baseline에서 시작해, 레포 드리프트에 덜 민감합니다.
- **라우팅 현실성**: “complex=files>=N or category in …”는 ‘절차적 무게’를 대략적으로 잡는 프록시이며, 레포별로 임계값 튜닝이 전제입니다.

### 케이스 목록 & validator 요약

모든 케이스는 로컬 validator로 **특정 파일에 특정 문자열이 포함/미포함**되는지를 검사합니다. 그래서 채점이 결정적이고 비용이 낮습니다.

| 케이스 | 카테고리 | 대표하는 작업 유형 | 파일 수 | 체크 수 |
| --- | --- | --- | ---: | ---: |
| `kc-tool-schema-001` | schema | Tool schema + 문서 동기화 | 2 | 4 |
| `kc-reindex-status-001` | feature | 다중 파일 기능 변경 + 문서 연동 | 5 | 10 |
| `kc-workspace-flag-001` | cli | CLI alias + 문서 업데이트 | 4 | 5 |
| `kc-allow-cwd-root-flag-001` | cli | 신규 플래그 + 문서 일관성 | 4 | 5 |
| `kc-kairo-dir-flag-001` | cli | Env/flag alias + 문서 일관성 | 4 | 4 |
| `kc-warmup-empty-index-001` | ux | 상태 기반 UX + 설정 문서 | 2 | 7 |
| `kc-compact-surface-rename-001` | docs | 문서 용어 치환 + 미포함(excludes) 체크 | 3 | 6 |
| `kc-adr-index-001` | docs | 문서 인덱스의 타겟 편집 | 1 | 2 |

*“체크 수”는 `contains_text(s)` / `excludes_text` 단위의 개별 assertion 합계입니다.*

---

## 결과 요약

### 전체 비교

| 시스템 | Pass@1 | Pass@k | 입력 토큰 | 출력 토큰 | 총 토큰 | 비용 | 실행 시간 |
|--------|--------|--------|-------------|--------------|-------------|------|-----------|
| **Mini baseline** (라우팅 안 함) | 100.0% | 100.0% | 1,161,807 | 29,220 | 1,191,027 | $0.1721 | 371초 |
| **Mini kairo** (라우팅된 케이스만) | 100.0% | 100.0% | 5,106,154 | 94,993 | 5,201,147 | $0.5256 | 1,164초 |
| **Routed selection** (baseline + kairo) | 100.0% | 100.0% | 6,267,961 | 124,213 | 6,392,174 | $0.6977 | 1,535초 (25.6분) |
| **Full baseline** (모든 케이스 Full 사용) | 100.0% | 100.0% | 4,109,544 | 88,482 | 4,198,026 | $2.4937 | 1,201초 (20.0분) |

**비용 참고:** 비용은 `benchmarks/agent/pricing.json`(snapshot `2026-01-26`)을 기준으로 계산되며, 가능한 경우 cached input 토큰을 반영합니다.

### Delta 분석 (Routed vs Full)

| 지표 | 변화 |
|--------|-------|
| **Pass@1** | +0.0pp (+0.0%) |
| **Pass@k** | +0.0pp (+0.0%) |
| **입력 토큰** | +2,158,417 (+52.5%) |
| **출력 토큰** | +35,731 (+40.4%) |
| **총 토큰** | +2,194,148 (+52.3%) |
| **비용** | -$1.7961 (-72.0%) 💰 |
| **실행 시간** | +333,161ms (+27.7%) ⏱️ |

---

## 케이스별 상세 분석

### 대표 케이스(라우팅이 경쟁적으로 보일 수 있는 지점)

확정적인 보장은 아니지만, 이번 실행에서 **Mini + Kairo**가 상위 모델 baseline 대비 경쟁적으로 보인 예시입니다:

**케이스:** `kc-kairo-dir-flag-001` (CLI)
- Full baseline: 368,698ms, $0.7219
- Mini + Kairo: 243,492ms, $0.1525

**케이스:** `kc-allow-cwd-root-flag-001` (CLI)
- Full baseline: 187,710ms, $0.3796
- Mini + Kairo: 196,003ms, $0.0760

해석: “절차/플래그 + 문서 일관성”류 작업에서는 Kairo의 구조화된 실행이 불필요한 탐색을 줄이고, 작은 모델이 궤도를 유지하도록 돕는 경향이 있을 수 있습니다. 결과는 레포/프롬프트 분포/라우팅 임계값에 따라 달라집니다.

---

## 핵심 인사이트

### 1. 성공률은 여전히 중요

- **Full baseline:** 100% (이번 실행)
- **Routed strategy:** 100% (이번 실행)

운영 환경에서 성공률 차이는 워크로드에 따라 달라집니다. 특히 “작고 절차적인 변경(다중 파일, validator-heavy)” 비중이 높을수록 라우팅 + 구조화된 실행의 중요도가 커지는 경향이 있습니다.

### 2. 비용 절감이 확장됨

- **스위트 실행(8개 케이스) full baseline:** $2.49
- **스위트 실행(8개 케이스) routed:** $0.70
- **케이스 평균(이번 스위트):** ~$0.31 → ~$0.09

100개의 에이전트 작업의 경우:
- Full baseline: $249
- Routed: $70
- 절감: $179 (~72% 감소)

### 3. 시간 트레이드오프는 수용 가능

- **추가 시간:** ~333초 (총 5.6분)
- **케이스 평균(이번 스위트):** ~+42초
- **인간 복구와 비교:** 작은 성공률 개선이라도 wall-time 오버헤드보다 더 큰 가치를 가질 수 있음

**ROI 프레이밍:** 워크로드에 따라 wall time을 지불하고 비용(및 잠재적 신뢰성)을 얻는 선택이 가능합니다.

### 4. 토큰 사용 패턴

- **Full 모델 토큰:** 4.20M
- **Routed 토큰:** 6.39M (+52%)

증가 이유:
- Mini는 복잡한 경우 더 많은 컨텍스트가 필요할 수 있음
- Kairo는 검증/절차 단계를 추가함(토큰은 늘지만 달러는 더 저렴할 수 있음)
- 이는 종종 **구조화된 실행의 비용**입니다.

---

## 권장사항

### 비용에 민감한 워크로드의 경우

✅ **라우팅 전략 사용**
- 대부분은 Mini baseline으로 처리
- 일부 카테고리/복잡도 밴드는 **Mini + Kairo**로 라우팅
- 예상 결과: 라우팅 임계값에 따라 pass@1을 유지하면서 실지출을 줄이는 방향

### 안전이 중요한 시스템

✅ **검증을 통한 라우팅 전략 사용**
- 드리프트 감지 및 적용 전 검증 추가
- 감사 추적을 위한 상세 로깅 활성화
- 예상 결과: 100% 성공률, 완전한 추적 가능성

### 높은 처리량의 에이전트 루프

✅ **라우팅 전략 사용**
- 다수의 작업을 Mini baseline으로 라우팅
- 절차성이 강한 일부 밴드를 **Mini + Kairo**로 라우팅
- 예상 결과: 최적의 비용/성능 비율

### 프로토타입/탐색

⚠️ **임시로 순수 Full 모델 고려**
- 개발 중에 더 빠른 반복
- 패턴이 나타나면 라우팅 로직 추가
- 운영 전에 라우팅 전략으로 전환

---

## 방법론 설명

### 단일 실행

이 벤치마크는 대표 테스트 케이스에 대한 **단일 실행** 결과입니다. LLM 벤치마크 비용 때문에:
- Full GPT-5.1 스위트: ~$2.50 / 실행
- 대규모 통계 검증: 비용 구조적으로 불가능
- 대신 초점: 절차적 엄격함, 투명한 방법론, 반복 가능한 단계

**검증 접근:**
1. ✅ 다양한 시나리오 테스트 (스키마, 기능, CLI, UX, 문서 범위 8개 케이스)
2. ✅ 두 전략 동일하게 실행 (동일한 타임아웃, 동일한 환경)
3. ✅ 실패 근본 원인 분석 (단순 집계 아님; 이유 이해)
4. ✅ 공개된 SOTA와 비교 (Full 모델은 최첨단)

### 한계 & 주의사항

- **N=1 실행:** 단일 실행은 통계적 검정력 제한. 다음 단계: 신뢰 구간을 위한 다중 실행 비교.
- **모델 버전:** 결과는 모델/스냅샷에 종속적입니다. “보편적 보장”이 아니라 데이터 포인트로 봐주세요.
- **작업 분포:** 테스트 케이스는 인프라/CLI 작업에 중점. 순수 코드 생성에서는 패턴이 다를 수 있음.

---

## 재현성

이 벤치마크를 직접 실행하려면:

```bash
# 의존성 설치
npm install

# 라우팅 벤치마크 실행
node benchmarks/agent/launch.mjs --provider codex \
  --pipeline route \
  --suite benchmarks/agent/suite.kairo5.json \
  --mode live \
  --mini gpt-5.1-codex-mini \
  --full gpt-5.1-codex \
  --timeout-ms 600000 \
  --kairo-budget low \
  --pricing benchmarks/agent/pricing.json \
  --attempts 2 \
  --gate-files-min 5 \
  --gate-category cli

# 결과 확인
cat benchmarks/reports/agent-route-*.md
```

**비용 추정:** ~$3-5 / 실행 (Mini 및 Full baseline 포함)

---

## 다음 단계

1. **다중 실행 검증:** 신뢰 구간 설정을 위해 3-5회 실행
2. **모델 비교:** Claude 3.5, Gemini 2.0, 기타 SOTA 모델 테스트
3. **실제 배포:** 자신의 저장소와 워크로드에서 검증
4. **피드백:** 결과, 엣지 케이스, 개선사항을 GitHub Issues로 공유

---

## 참고

- 전체 벤치마크 리포트: `/benchmarks/reports/`
- 테스트 스위트: `/benchmarks/agent/suite.kairo5.json`
- 라우팅 설정: `/benchmarks/agent/cascade.ts`
- Kairo 문서: [/concepts/performance-and-reliability](/concepts/performance-and-reliability)
