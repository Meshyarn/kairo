# 기본값 고르기

Kairo는 의도적으로 설정 옵션이 많지만, 대부분의 프레임워크는 “보수적인 기본값” 몇 개로 수렴하는 것이 도구 호출 신뢰도를 높입니다.

## 베이스라인 기본값(권장)

특별한 이유가 없다면 아래를 권장합니다:

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact`
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`

## Preset: 저장소 규모 + 깊이 기준

| 상황 | 추천 preset | 비고 |
|---|---|---|
| 소/중형 저장소, 빠른 반복 | `KAIRO_PRESET=mcp-lean` | 가장 가벼운 기본값. |
| 대형 저장소, 리콜↑ | `KAIRO_PRESET=mcp-balanced` | 깊이↑, 비용도 약간↑. |
| 심층 감사, 초대형 저장소 | `KAIRO_PRESET=mcp-deep` | 비용↑; timebox 권장. |

## 프레임워크 라우팅 기본값(먼저 구현할 것)

1. 대부분의 의도는 `task`부터 시작
2. 깊이는 프롬프트가 아니라 `manage` artifacts로 확장
3. 쓰기는 plan-first + 명시적 승인 후 apply

참고:

- [공개 표면](/ko/concepts/public-surface)
- [도구 레퍼런스](/ko/agent/TOOL_REFERENCE)

