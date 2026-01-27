# 에이전트 문서

이 섹션은 Kairo의 공개 도구 표면(public tool surface)에 대해 **에이전트 프레임워크가 무엇을 기대할 수 있는지**를 문서화합니다.

여기서 시작하세요:

- [빠른 참고서](/ko/agent/quick-reference) — 호스트/프레임워크 통합 치트시트
- [도구 레퍼런스 (Public Surface)](/ko/agent/TOOL_REFERENCE) — 안정 계약(compact + pillars)
- [에이전트 플레이북](/ko/agent/AGENT_PLAYBOOK) — 권장 사용 패턴(evidence packs + compact 후속 호출)

## 프레임워크 친화 기본값

Kairo가 에이전트에게 “자주” 호출되길 원한다면, 아래를 권장합니다:

- `KAIRO_PUBLIC_SURFACE=compact` (`task` + `manage`)
- `KAIRO_TOOL_SCHEMA_MODE=compat` (호스트가 top-level에 추가 필드를 붙여도 관용적으로 처리)
- `KAIRO_ALLOW_STDOUT_LOGS=false` + `KAIRO_LOG_TO_FILE=true` (stdio 프레임 보호)

## 호스트 통합 팁

- `guidance.nextCalls`가 있으면 가능한 한 그대로 실행하세요(특히 apply 흐름).
- 더 깊은 evidence가 필요하면 `manage({ command: "artifact", target, detail: "full" })`로 pack을 가져오세요.
- 프레임워크에서 tool 호출을 라우팅한다면, apply 작업은 serialize 하세요(plan/apply 토큰은 1회성).

