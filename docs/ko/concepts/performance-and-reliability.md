# 성능 & 신뢰성

Kairo는 MCP 호스트(IDE/에이전트) 아래에서 **stdio MCP 서버**로 동작하도록 설계되어 있습니다. 신뢰성 이슈는 대부분 아래 3가지 중 하나에서 발생합니다:

1) **stdout 프레이밍 깨짐**(로그가 MCP 프레임에 섞임)  
2) **콜드/스테일 인덱스**(첫 호출이 느림, 커버리지 저하, 드리프트)  
3) **호스트 타임아웃/리소스 제한**(요청이 호스트에 의해 종료)

이 문서는 *최신* 설정 포인트와 빠른 진단 흐름에 집중합니다.

---

## Rule #1: stdout 프레이밍을 깨지 마세요

권장 기본값:

- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`
- `KAIRO_LOG_DIR` 또는 `KAIRO_LOG_FILE`로 로그 경로 제어

참고: [로깅 & 텔레메트리](/ko/reference/configuration/logging-and-telemetry)

---

## 인덱스 상태, 드리프트, “왜 느려졌지?”

```bash
manage({ command: "status", detail: "summary" })
```

고신호 필드:

- `nativeSearch.available` 및 `nativeSearch.stats.docCount` (렉시컬 인덱스 준비 상태)
- `status.global.totalFiles` vs `status.global.indexedFiles` (커버리지)
- `indexSnapshot.coverageRatio` 및 `indexSnapshot.staleRisk` (스테일 위험)
- `drift.workspaceDrift` (외부 편집/드리프트 감지)

자주 쓰는 복구:

- 콜드 스타트: `manage({ command: "reindex" })`
- 드리프트 복구: `manage({ command: "reindex", paths: [...] })`(부분) → `manage({ command: "reindex" })`(전체)

---

## 응답을 작게 유지하기(타임아웃/비용 감소)

권장 제어:

- 호출 단위 상한: `limits.maxTokens`, `limits.maxChars`, `limits.timeoutMs`
- 서버 기본값: `.kairo/config/mcp.json` → `budgets` + `timeboxMs`
- 결과 크기: `KAIRO_MAX_RESULTS`

참고:
- [예산(Budgets)](/ko/reference/configuration/budgets)
- [프로젝트 설정 파일](/ko/reference/configuration/project-files)

---

## 권장 preset 베이스라인

시작점으로 preset을 쓰고, 필요 시 튜닝하세요:

- `KAIRO_PRESET=mcp-lean` (빠른 반복/작은 출력)
- `KAIRO_PRESET=mcp-balanced` (일반 사용; ADR-091 이후 기본값)
- `KAIRO_PRESET=mcp-deep` (에이전트 루프/깊은 분석)

preset은 env 또는 `.kairo/config/mcp.json`으로 설정할 수 있습니다.

---

## 임베딩 & 벡터 인덱스(선택)

임베딩을 활성화하면 최초 구축 시 CPU/메모리 사용량이 증가할 수 있습니다.

주요 포인트:

- `KAIRO_EMBEDDING_PROVIDER=auto|local|remote|disabled`
- `KAIRO_EMBEDDING_MODEL`, `KAIRO_EMBEDDING_PACK_FORMAT`
- `KAIRO_VECTOR_INDEX`, `KAIRO_VECTOR_INDEX_REBUILD`, `KAIRO_VECTOR_INDEX_SHARDS`

참고: [검색 & 임베딩 설정](/ko/reference/configuration/search-and-embeddings)

---

## “Kairo가 아니라 호스트 문제”를 의심해야 할 때

요청이 중간에 끊긴다면:

- 호스트 타임아웃을 늘리세요(호스트별 설정).
- 호출을 작게 쪼개세요(상한 + 결과 수 감소).
- `manage({ command: "status" })`로 서버가 degrade 상태인지 확인하세요.

---

## Next

- [성능 기준(대표값)](/ko/performance/baselines)
- [배포 시나리오](/ko/guides/deployment-scenarios)
- [운영 런북](/ko/guides/ops-runbook)
