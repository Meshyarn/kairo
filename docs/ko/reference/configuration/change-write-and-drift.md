# change/write & drift

Kairo의 쓰기 안전성은 plan → apply 핸드셰이크와 drift 인지 차단을 중심으로 설계되어 있습니다.

## 핵심 설정

| 변수 | 용도 |
|---|---|
| `KAIRO_MODE` | `mcp`는 apply 게이트를 활성화; `dev`는 MCP 기본값을 끔. |
| `KAIRO_TOOL_SCHEMA_MODE` | `compat`(권장) vs `strict`. |
| `KAIRO_PUBLIC_SURFACE` | `compact` vs `pillars`. |

## manage import 안전

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_MANAGE_IMPORT_ALLOW_EXTERNAL` | `.kairo` 밖에서 `manage import`를 허용. | 기본 `false`; 필요한 경우에만 opt-in. |

## drift 체크(ADR-077)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_DRIFT_CHECK_MAX_FILES` | 워크스페이스 drift 계산 시 샘플링하는 최대 인덱싱 파일 수. | 기본 200. |
| `KAIRO_FORMATTER_MAX_FILES` | formatter bridge apply의 최대 파일 수. | 기본 10. |
| `KAIRO_FORMATTER_ALLOW_UNTRACKED` | undo/rollback이 가능하더라도 formatter bridge가 기록되지 않는(히스토리 미추적) 쓰기를 허용. | 기본 `false`. |
| `.kairo/config/scopes.json` | 수동 scope 오버라이드. | 선택; drift 그룹핑을 위한 `serviceRoot` scopes 정의. |

## 무결성 감사(ADR-041)

| 변수 | 용도 |
|---|---|
| `KAIRO_INTEGRITY_MODE` | 기본 무결성 동작. |
| `KAIRO_INTEGRITY_SCOPE` | 기본 스코프(`docs` vs `project` vs `auto`). |
| `KAIRO_INTEGRITY_BLOCK_POLICY` | high-severity 발견이 apply를 block할지 여부. |

## Writer’s flow 기본값(ADR-051)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_WRITERS_FLOW_DEFAULT_DRYRUN` | sessionId가 있을 때 writer flow 기본 dry-run. | `on|off|beta|canary` |
| `KAIRO_WRITERS_FLOW_REVIEW_DEFAULTS` | session 기반 reviewOptions 기본값 활성화. | `on|off|beta|canary` |

## StylePack 캐시(ADR-051)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_STYLE_PACK_TTL_MS` | 세션 간 StylePack 재사용 TTL(ms). | 기본: `1800000` (30분). |
| `KAIRO_STYLE_PACK_CACHE_SIZE` | 캐시되는 StylePacks 최대 개수. | 기본: `50`. |
| `KAIRO_CALLGRAPH_MAX_NODES` | call graph artifacts에 저장되는 최대 노드 수. | 기본: `500`. |
| `KAIRO_CALLGRAPH_MAX_EDGES` | call graph artifacts에 저장되는 최대 엣지 수. | 기본: `1500`. |

## 원문 소스(ContentSource) (ADR-089)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_CONTENT_SOURCE_MAX_BYTES` | `contentSource.kind="file"` 읽기 최대 바이트. | 기본 `1048576`(1MB). |

사용 흐름:

- [안전한 쓰기(개념)](/ko/concepts/safe-writes)
- [원문 콘텐츠 전달(가이드)](/ko/guides/raw-content)
- [도구 레퍼런스](/ko/agent/TOOL_REFERENCE)
