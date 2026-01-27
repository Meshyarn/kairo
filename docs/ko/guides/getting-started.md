# 시작하기 (Kairo)

Kairo는 **stdio**로 통신하는 MCP 서버입니다. MCP 호스트가 Kairo를 실행하고 타임아웃/권한을 적용합니다.

기본값(`KAIRO_MODE=mcp`)에서는 Kairo가 **compact** 도구 표면(`task` + `manage`)만 노출합니다. Five Pillars를 직접 호출하고 싶다면 `KAIRO_PUBLIC_SURFACE=pillars`를 설정하세요.

## 요구사항

- Node.js (최신 LTS 권장)
- `npm` (또는 호환 도구)

## 이 레포에서 실행

```bash
cd kairo
npm ci
npm run build
node dist/index.js --root /absolute/path/to/your/project
```

런타임 데이터(indexes/caches/logs)는 기본적으로 대상 프로젝트 루트의 `.kairo/` 아래에 저장됩니다.

## 네이티브 코어(검색 + 성능)

Kairo는 Tantivy 기반 검색 및 기타 성능 민감 경로를 위해 네이티브 모듈(`@kairo/core-rs`)을 사용합니다.

`CAP_NATIVE_SEARCH_UNAVAILABLE`가 보이거나(또는 지원되지 않는 플랫폼/아키텍처인 경우) 로컬 빌드를 수행하세요:

```bash
# Rust toolchain(cargo)이 필요합니다
npm run build:core-rs
```

빠른 스모크( `dist/index.js`를 실행하고 stdio로 tool 호출 ):

```bash
npm run smoke:mcp-mock-client
```

## 검색 & 임베딩(offline-first)

Kairo는 렉시컬 검색(네이티브 코어)과 선택적 벡터 검색(임베딩 + 인덱스)을 지원합니다. 오프라인 운영/번들링/인덱싱 워크플로우는 아래로 분리했습니다:

- [검색 & 임베딩(가이드)](/ko/guides/search-and-embeddings)
- [검색 & 임베딩 설정(레퍼런스)](/ko/reference/configuration/search-and-embeddings)

## MCP 서버로 사용하기(예시 설정)

빌드된 엔트리로 MCP 호스트를 연결하세요(Claude CLI / Gemini CLI / Codex CLI 모두 “stdio MCP server” 개념이 있으며, 설정 JSON 형태는 다르더라도 이 필드들은 동일합니다):

```json
{
  "command": "node",
  "args": ["/absolute/path/to/kairo/dist/index.js", "--root", "/absolute/path/to/your/project"],
  "timeout": 300000,
  "env": {
    "NODE_OPTIONS": "--max-old-space-size=4096",
    "KAIRO_MODE": "mcp",
    "KAIRO_PUBLIC_SURFACE": "compact",
    "KAIRO_LOG_TO_FILE": "true",
    "KAIRO_ALLOW_STDOUT_LOGS": "false",
    "KAIRO_MAX_RESULTS": "25"
  }
}
```

MCP 호스트가 다른 working directory에서 서버를 실행한다면, 항상 `--root`(또는 `KAIRO_ROOT_PATH` / `KAIRO_ROOT`)를 지정하세요.

## 권한(권장)

읽기 우선(read-first) 워크플로우를 권장합니다:

- compact surface: 기본으로 `task` / `manage`만 허용
- pillars를 노출한다면: 기본으로 `explore` / `understand`를 허용하고, 실제 적용 의도가 있을 때만 `change` / `write`를 허용

일부 MCP 호스트는 tool name과 shell command에 대한 allow/deny 리스트를 지원합니다. 지원한다면 read-only로 시작하고 점진적으로 확장하세요.

## 혼합 워크플로우 복원력([ADR-077](/adr/ADR-077-mixed-workflow-resilience))

Kairo는 외부 편집이 언제든 발생할 수 있다고 가정합니다. drift가 감지되면 아래의 복구 사다리를 따르세요:

1) 대상 파일을 다시 읽고(`read`/`explore` view=full) dry-run으로 재시도
2) 가능하면 변경된 경로만 reindex (`manage({ command: "reindex", paths: [...] })`)
3) drift가 지속되면 프로젝트 전체 reindex (`manage({ command: "reindex" })`)
4) 그래도 차단되면, scope를 더 좁히고 명시적 edits(targetString/replacementString)를 제공

`manage({ command: "status" })`로 `drift`를 확인하고, `manage({ command: "history" })`로 최근 체크포인트를 확인하세요.

## 첫 호출 (예제로 배우기)

자세한 예제와 예상 응답 구조는 [빠른 시작 → 첫 호출](/ko/quickstart/first-calls)을 참고하세요:

- 상태 확인: `manage({ command: "status" })`
- 엔트리포인트 찾기: `task({ request: "프로그램 엔트리포인트 찾기", mode: "ask" })`
- 아키텍처 설명: `task({ request: "아키텍처 설명", mode: "analyze", budget: "balanced" })`
- 깊은 증거 가져오기: `manage({ command: "artifact", target: "...", detail: "full" })`

코드 편집의 경우, 2단계 패턴을 따르세요:

1. **Plan**: `task({ request: "Plan: ...", mode: "plan_change", targetFiles: [...] })`
2. **Apply**: `task({ mode: "apply_change", draftId, applyToken })`

전체 워크플로우는 [안전한 쓰기 활성화](/ko/quickstart/enable-writes)를 참고하세요.

---

## 첫 호출 후: 검증 체크리스트

첫 번째 성공적인 호출을 한 후, 진행하기 전에 설정을 검증하세요:

### 1. MCP 연결 검증

```bash
# 도구 가용성 확인
task({ request: "What tools are available?", mode: "ask" })

# 예상: 응답에서 `task`, `manage` 및 사용 가능한 `guide` 도구 나열
```

### 2. 프로젝트 인덱싱 상태 확인

```bash
manage({ command: "status" })
```

확인 항목:
- ✅ `indexHealth.state`: `"healthy"`
- ✅ `languagesDetected`: 프로젝트 언어 (TypeScript, Python 등)
- ✅ `nativeCore.available`: `true` (렉시컬 검색 활성화)

### 3. 에러 처리 검증

의도적으로 나쁜 요청을 만들어 가이드 확인:

```bash
task({ request: "foobar gibberish impossible request", mode: "auto" })
```

예상 응답 구조:

```json
{
  "success": false,
  "error": "No matching symbols found",
  "guidance": [
    "Refine your search terms",
    "Try a broader query",
    "Use 'ask' mode for natural language"
  ]
}
```

### 4. 빠른 성능 기준선

일반적인 쿼리를 실행하고 지연 시간 기록:

```bash
# 시간 측정
task({ request: "List all exported functions", mode: "auto" })

# p50 (웜): 10-50ms여야 함
# p95 (콜드): 50-200ms여야 함
```

훨씬 느리면 [성능 & 신뢰성](/ko/concepts/performance-and-reliability)을 확인하세요.

### 5. 로그 캡처 확인

로깅 설정 검증:

```bash
# 존재하고 최근 항목이 있어야 함
tail -20 .kairo/kairo.log

# 표시되는 것: 타임스탬프, 작업 이름, 민감한 데이터 없음
```

### 6. 다음: 환경 초기화

```bash
manage({ command: "init" })
```

이는 인덱스와 캐시를 사전 워밍하여 이후 쿼리를 더 빠르게 합니다.

그 다음 배포 시나리오를 따릅니다:
- **개발:** [개발 시나리오](/ko/guides/deployment-scenarios#시나리오-1-개발-로컬-머신)
- **팀:** [팀 CI/CD 시나리오](/ko/guides/deployment-scenarios#시나리오-2-팀-cicd-공유-컨테이너빌드-시스템)
- **프로덕션:** [프로덕션 에이전트 시나리오](/ko/guides/deployment-scenarios#시나리오-3-프로덕션-에이전트-높은-처리량)

---

공개 개요는 `README.md`를 참고하세요.

## Next

- 설정: `docs/ko/guides/configuration.md`
- 프롬프트리스 MCP 설정: `docs/ko/guides/promptless-integration.md`
- 운영 런북: `docs/ko/guides/ops-runbook.md`
