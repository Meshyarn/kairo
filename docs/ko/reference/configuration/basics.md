# 기본(Basics)

대부분의 프레임워크는 몇 가지 설정만으로도 충분히 안정적인 “첫 성공”을 만들 수 있습니다.

권장 시작 포지션은 아래를 참고하세요:

- [기본값 고르기](/ko/quickstart/pick-your-defaults)

## 공통 환경 변수

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_ROOT_PATH` | 분석할 프로젝트 루트. | cwd보다 권장; CLI `--root` 인자와 동일. |
| `KAIRO_ROOT` | 분석할 프로젝트 루트. | `KAIRO_ROOT_PATH`의 alias. |
| `KAIRO_MODE` | 정책 모드. | `mcp`(기본), `dev`, `ci`. MCP 기본값을 끄려면 `dev`. |
| `KAIRO_PRESET` | MCP preset. | `mcp-balanced`(기본; ADR-091), `mcp-lean`, `mcp-deep`. |
| `KAIRO_PUBLIC_SURFACE` | 공개 도구 표면. | `compact`(mcp에서 기본; `task`+`manage`만) 또는 `pillars`(Five Pillars). |
| `KAIRO_DIR` | 데이터 디렉터리. | 기본값 `.kairo` (index/cache/history 포함). |
| `KAIRO_ALLOW_LEGACY_MCP_DIR` | `KAIRO_DIR`에 대해 레거시 `.mcp` 경로를 허용. | (Deprecated) `true`면 `.mcp`/`.mcp/kairo` 허용; 아니면 `.kairo` 사용. |
| `KAIRO_MAX_RESULTS` | 검색 결과 상한. | 토큰 효율을 위해 낮추고, 리콜을 위해 높이세요. |
| `KAIRO_LOG_LEVEL` | 구조화 로그 레벨. | `debug|info|warn|error`. |
| `KAIRO_LOG_TO_FILE` | `.kairo` 아래에 로그를 파일로 저장. | MCP 호스트에서는 권장(stdout를 깨끗하게 유지). |
| `KAIRO_ALLOW_STDOUT_LOGS` | stdout 로그 허용. | MCP 호스트에서는 피하세요(stdout는 MCP 프레임 전용). |
| `KAIRO_STORAGE_MODE` | 스토리지 백엔드. | `file`(기본) 또는 `memory`(비영속). |
| `KAIRO_TOOL_SCHEMA_MODE` | 도구 스키마 모드(계약 enforcement). | `compat`(기본)은 알 수 없는 top-level 필드를 제거; `strict`는 거부. |
| `KAIRO_EXPOSE_INTERNAL_TOOLS` | MCP `list_tools`에 내부 도구를 노출. | 기본 `false`; 내부 도구 이름은 불안정. |
| `KAIRO_EXPOSE_FILE_TOOLS` | MCP `list_tools`에 compat file tools를 노출. | 기본 `false`; 가능하면 Five Pillars 선호. |

타임아웃은 주로 MCP 호스트(요청 단위 타임아웃)가 제어합니다. 일부 작업은 `limits.timeoutMs`로 호출 단위 타임아웃도 지원합니다([도구 레퍼런스](/ko/agent/TOOL_REFERENCE) 참고).

## deprecated env vars

이 환경 변수들은 아직 동작하지만, 향후 릴리스에서 제거될 예정입니다:

- `KAIRO_ROOT` → `KAIRO_ROOT_PATH` 또는 `--root` 사용
- `KAIRO_EXPOSE_LEGACY_TOOLS` → `KAIRO_EXPOSE_INTERNAL_TOOLS` 사용
- `KAIRO_EXPOSE_COMPAT_TOOLS` → `KAIRO_EXPOSE_FILE_TOOLS` 사용
- `KAIRO_ALLOW_LEGACY_MCP_DIR` → 레거시 `.mcp` 경로는 deprecated

