# 에이전트 프레임워크 연동 (MCP 호스트 체크리스트)

이 문서는 stdio로 Kairo를 실행하는 **에이전트 프레임워크 / MCP 호스트 개발자**(또는 tool router를 만드는 경우)를 위한 체크리스트입니다.

목표: 에이전트가 Kairo를 **신뢰**하고, 그 결과 **자주 호출**하도록 만드는 것.

## 권장 기본값(호스트)

compact + promptless 친화 설정으로 시작하세요:

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact` (기본 도구는 `task` + `manage`만 노출)
- `KAIRO_TOOL_SCHEMA_MODE=compat` (호스트가 top-level에 추가 필드를 붙여도 hard fail 방지)
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`
- 항상 `--root /abs/path/to/repo`(또는 `KAIRO_ROOT_PATH`)를 고정

참고: [프롬프트리스 MCP 연동](/ko/guides/promptless-integration)

## stdio 신뢰성 요구사항

호스트가 stdio MCP를 구현할 때 가장 흔한 실패 지점은 다음입니다:

- **stdout는 MCP 프레임 전용이어야 합니다.** 프로토콜 외 stdout 출력은 스트림을 오염시킵니다.
- stderr는 로그로 취급하거나(권장), 로그를 파일로 보내세요.
- 런타임이 stdout/stderr를 파이프/머지하는 경우, 로그가 JSON-RPC 출력과 섞이지 않도록 보장해야 합니다.
- 가능하다면 **요청 타임아웃 + cancellation**을 구현하세요.

## tool name / 라우팅

일부 MCP 호스트는 tool name에 서버 prefix를 붙여 보여줍니다(예: `kairo_task`). 프레임워크에서는:

- `list_tools`가 반환한 tool name을 그대로 사용하세요(prefix 하드코딩 금지).
- compact surface에서는 **`task`를 기본 엔트리포인트**로 취급하세요.
- 전체 스키마가 필요하면 `manage({ command: "schema", tool: "task", detail: "full" })`를 호출하세요.

## apply 핸드셰이크(plan → apply)

Kairo의 신뢰 모델은 **2단계 계약(two-phase contract)** 을 전제로 합니다:

1. **Plan**은 draft pack(`draftId`)을 반환하고, MCP 모드에서는 **원타임** `applyToken`을 발급합니다.
2. **Apply**는 `draftId + applyToken`을 요구합니다.
3. 외부 변경(drift)이 발생하면 apply가 차단될 수 있으며, 이 경우 에이전트는 재계획(re-plan)해야 합니다.

프레임워크 팁:

- `applyToken`은 **1회성**으로 취급하고, 재시도에 재사용하지 마세요.
- 응답에 `guidance.nextCalls`가 있으면 우선적으로 그대로 실행하세요(올바른 `draftId/applyToken/sessionId`를 포함).
- 토큰 레이스를 피하기 위해 서버/세션 단위로 apply 호출을 serialize 하세요.

## “blocked” / “partial_success” 처리

프레임워크는 Kairo 응답을 “실행 가능한 guidance”로 취급해야 합니다:

- `status="partial_success"`: 요약을 보여주고 제안된 다음 호출(artifact fetch, scope 축소 등)을 따라가세요.
- `status="blocked"`: 크래시가 아니라 안전/정책 게이트입니다. 더 좁은 스코프로 재계획하거나 fileVersions를 갱신하세요.

대표적인 block 이유:

- `applyToken` 누락/만료/사용됨
- draft target 불일치(호스트가 일관되지 않은 `targetPath`를 다시 보냄)
- drift (plan과 apply 사이 파일 변경)
- 정책/가드레일 차단(review/semantic 제약)

## 관측(Observability) 훅

프로덕션 통합에서는 다음을 추천합니다:

- `manage({ command: "status" })`로 drift/native search/workflow 상태 등 헬스를 표출
- `manage({ command: "doctor", scope: "host" })`로 호스트 설정 진단
- 프롬프트 없이 실제 사용을 수집하려면(선택): `KAIRO_BETA_LOG_ENABLED=true` (기본 경로: `.kairo/logs/beta.ndjson`)

## E2E 신뢰 검증

호스트 라우팅 로직을 수정했다면 change/write 핸드셰이크를 E2E로 확인하세요:

- (EN) [ADR-088](/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program)
- `scripts/adr-088-*.mjs`의 smoke suites (특히 change/write apply 흐름)

