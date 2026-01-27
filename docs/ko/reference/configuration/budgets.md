# 토큰 예산(Token budgets)

Kairo는 `limits.maxTokens`(토큰 우선)뿐 아니라 `limits.maxChars`(문자 상한)로도 응답 크기를 캡할 수 있습니다.

참고: [ADR-080](/adr/ADR-080-response-envelope-token-budget-explore-understand).

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_DEFAULT_MAX_TOKENS` | 기본 토큰 예산(서버 측). | pillar가 자체 기본값을 지정하지 않았고 호출이 `limits.maxTokens`를 전달하지 않았을 때 사용. |
| `KAIRO_EXPLORE_MAX_TOKENS` | `explore` 기본 토큰 예산. | `KAIRO_DEFAULT_MAX_TOKENS`를 오버라이드. |
| `KAIRO_UNDERSTAND_MAX_TOKENS` | `understand` 기본 토큰 예산. | `KAIRO_DEFAULT_MAX_TOKENS`를 오버라이드. |
| `KAIRO_READ_MAX_TOKENS` | `read` 기본 토큰 예산. | `KAIRO_DEFAULT_MAX_TOKENS`를 오버라이드. |
| `KAIRO_MANAGE_MAX_TOKENS` | `manage` 응답 기본 토큰 예산. | `manage command=artifact` envelope caps에 사용. |
| `KAIRO_MANAGE_MAX_CHARS` | `manage` 응답 기본 JSON char cap. | `manage command=artifact` envelope caps에 사용. |
| `KAIRO_TOKEN_ESTIMATOR` | 토큰 추정기 모드. | `whitespace`(기본) 또는 `chars`. |

