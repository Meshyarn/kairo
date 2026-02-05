# 로깅 & 텔레메트리

Kairo는 stdio MCP 서버로 동작합니다. 가장 중요한 규칙은 **stdout 프레이밍을 깨지 않는 것**입니다.

## 권장 기본값

| 변수 | 권장값 | 이유 |
|---|---|---|
| `KAIRO_LOG_TO_FILE` | `true` | stdout를 MCP 프레임 전용으로 유지. |
| `KAIRO_ALLOW_STDOUT_LOGS` | `false` | 호스트의 JSON 파싱 오류를 방지. |
| `KAIRO_LOG_LEVEL` | `info` (필요 시 잠시 `debug`) | `debug`는 조사 시에만. |
| `KAIRO_LOG_DIR` | *(선택)* | 기본 로그 디렉터리를 오버라이드 (기본: `<KAIRO_DIR>/logs`). |
| `KAIRO_LOG_FILE` | *(선택)* | 스트림별 로그 대신 단일 파일로 모든 로그를 기록. |

메모:

- MCP 호스트에서는 file logging을 권장합니다. stdout에 로그가 섞이면 MCP JSON 프레이밍이 깨질 수 있습니다.
- 호스트 통합 문제를 조사할 때는 로그 + `manage({ command: "status" })` 결과를 함께 수집하고, apply 흐름은 serialize 하세요.
- `KAIRO_LOG_TO_FILE=true`이고 `KAIRO_LOG_FILE`을 설정하지 않으면, Kairo는 `KAIRO_LOG_DIR`(기본: `<KAIRO_DIR>/logs`) 아래에 `console.log`, `console.warn.log`, `console.error.log`, `stdout.log`, `stderr.log` 등을 기록합니다.

## 베타 텔레메트리(opt-in)

| 변수 | 용도 |
|---|---|
| `KAIRO_BETA_LOG_ENABLED` | `.kairo/logs/` 아래 sanitize된 NDJSON 사용 로그 기록. |
| `KAIRO_BETA_LOG_PATH` | 베타 로그 경로 오버라이드. |
| `KAIRO_HOST_NAME` | 멀티 호스트 테스트용 태그. |

참고:

- [운영 런북](/ko/guides/ops-runbook)
