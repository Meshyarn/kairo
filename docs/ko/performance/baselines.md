# 성능 기준(대표값)

이 문서는 “Kairo가 실제로 얼마나 빠른가”에 대한 **레포 내 벤치마크 결과(실측 값)** 를 보존하기 위한 페이지입니다.

단, 아래 값들은 **절대 보장값이 아닙니다**. 하드웨어, 레포 규모, preset/config, MCP 호스트 타임아웃 정책에 따라 달라집니다.

재현 방법은 문서 하단을 참고하세요.

---

## 엔진 벤치마크(P2 진단)

소스 런:

- 리포트: `benchmarks/reports/full-report-1767430513134.md`
- 생성일: 2026-01-03
- 시나리오: `p2-m`

리포트에서 발췌한 핵심 값:

| 지표 | 값 |
|---|---:|
| 콜드 스타트(500 files) | 24.334 ms |
| 증분 스캔 | 4.294 ms |
| 검색 지연 p50 | 50.979 ms |
| 검색 지연 p95 | 56.374 ms |
| RSS | 456.8 MB |
| 총 스토리지 | 463.8 MB |
| Recall@10 (scenario) | 100.0% |

메모:

- “콜드 스타트”는 벤치마크 스크립트가 정의한 startup 단계의 측정값입니다(방법론은 `benchmarks/main.ts` 참고).
- recall 같은 품질 지표는 시나리오 의존적이며, 절대 점수라기보다 회귀(regression) 감지용 가드레일로 보는 편이 좋습니다.

---

## 에이전트 라우팅 벤치마크(비용 vs 신뢰성)

소스 런:

- 리포트: `benchmarks/reports/agent-route-2026-01-27T05-18-02-427Z.md`
- 날짜: 2026-01-27
- 스위트: `benchmarks/agent/suite.kairo5.json`

**라우팅 선택 vs 풀 baseline**(동일 스위트, 해당 런 기준):

| 지표 | 변화 |
|---|---:|
| Pass@1 | +0.0pp |
| 총 비용 | -72.0% |
| 총 wall time | +27.7% |
| 총 토큰 | +52.3% |

Kairo가 노리는 핵심 트레이드오프는 “**성공률을 유지하면서 비용을 낮추고**”, 절차적 실행/검증 오버헤드를 일부 감수하는 것입니다.

참고: [벤치마크 리포트](/ko/performance/benchmarks)

---

## 검색 정확도 마이크로벤치마크(지연)

소스 런:

- 리포트: `benchmarks/reports/adr-088-search-accuracy-1769184311937.json`

핵심 값(해당 런 기준):

| 지표 | 값 |
|---|---:|
| 지연 avg | 29.33 ms |
| 지연 p50 | 29.24 ms |
| 지연 p95 | 31.64 ms |

---

## 재현(이 레포)

엔진 벤치마크(리포트는 `benchmarks/reports/` 아래에 생성):

```bash
node --import tsx benchmarks/main.ts --scenario p2-m
```

에이전트 route 벤치마크(리포트는 `benchmarks/reports/` 아래에 markdown으로 생성):

```bash
node benchmarks/agent/launch.mjs --provider codex --pipeline route \
  --suite benchmarks/agent/suite.kairo5.json --mode live \
  --mini gpt-5.1-codex-mini --full gpt-5.1-codex \
  --timeout-ms 600000 --kairo-budget low \
  --pricing benchmarks/agent/pricing.json \
  --attempts 2 --gate-files-min 5 --gate-category cli
```

추가 참고: `benchmarks/README.md`

