# MCP 호스트 체크리스트(stdio)

많은 “랜덤하게 실패하는 것처럼 보이는” MCP 문제는 모델 문제가 아니라 호스트 통합 문제인 경우가 많습니다.

stdio 서버로 Kairo를 연결할 때 이 체크리스트를 사용하세요.

## 필수

- **루트 경로**: 호스트의 cwd가 다르면 항상 `--root`(또는 `KAIRO_ROOT_PATH`) 지정
- **타임아웃**: 첫 실행(인덱싱/검색)에는 시간이 걸릴 수 있으니 충분히 길게
- **stdout 청결**: stdout는 MCP 프레임 전용
  - `KAIRO_LOG_TO_FILE=true` 권장
  - `KAIRO_ALLOW_STDOUT_LOGS=false` 권장
- **동시성**: apply 흐름은 serialize(토큰 1회성)

## 강력 권장

- `KAIRO_TOOL_SCHEMA_MODE=compat` (호스트가 필드를 추가해도 하드 실패 방지)
- 진단 경로에 `manage({ command:"status" })` 포함(drift, 인덱스, 네이티브 코어 상태)
- `guidance.nextCalls`가 있으면 그대로 실행

## 흔한 함정

- 호스트가 도구 이름에 prefix를 붙임(예: `kairo_task`). canonical 이름은 `task`/`manage`.
- stdout 로그가 MCP JSON 프레이밍을 깨서 “파싱 오류”가 랜덤하게 발생
- apply token 누락/재사용으로 write가 “blocked”됨

참고:

- [프롬프트리스 MCP 연동](/ko/guides/promptless-integration)
- [운영 런북](/ko/guides/ops-runbook)

