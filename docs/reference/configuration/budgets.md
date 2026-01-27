# Token budgets

Kairo can cap responses using `limits.maxTokens` (token-first) in addition to `limits.maxChars` (character caps).

See also: [ADR-080](/adr/ADR-080-response-envelope-token-budget-explore-understand).

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_DEFAULT_MAX_TOKENS` | Default token budget (server-side). | Used when a pillar does not specify its own default and the call does not pass `limits.maxTokens`. |
| `KAIRO_EXPLORE_MAX_TOKENS` | Default token budget for `explore`. | Overrides `KAIRO_DEFAULT_MAX_TOKENS`. |
| `KAIRO_UNDERSTAND_MAX_TOKENS` | Default token budget for `understand`. | Overrides `KAIRO_DEFAULT_MAX_TOKENS`. |
| `KAIRO_READ_MAX_TOKENS` | Default token budget for `read`. | Overrides `KAIRO_DEFAULT_MAX_TOKENS`. |
| `KAIRO_MANAGE_MAX_TOKENS` | Default token budget for `manage` responses. | Used for `manage command=artifact` envelope caps. |
| `KAIRO_MANAGE_MAX_CHARS` | Default JSON char cap for `manage` responses. | Used for `manage command=artifact` envelope caps. |
| `KAIRO_TOKEN_ESTIMATOR` | Token estimator mode. | `whitespace` (default) or `chars`. |
