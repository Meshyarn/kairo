# 공개 표면: `compact` vs `pillars`

Kairo는 프레임워크가 **안정성(호출 빈도)**을 우선 확보한 뒤 필요할 때 깊게 확장할 수 있도록, 두 가지 “공개 표면(public surface)”을 제공합니다.

## Compact (권장)

`KAIRO_MODE=mcp`에서 기본:

- 도구: `task`, `manage`
- 목표: 공개 계약을 **작고 안정적으로** 유지해, 제네릭 MCP 호스트/에이전트 프레임워크에서도 프롬프트 없이 안정적으로 라우팅

실전 효과:

- 표면이 예측 가능할수록 에이전트는 도구를 더 자주 호출합니다.
- 프레임워크는 “`task` 먼저”라는 하나의 라우팅 전략으로 대부분의 워크플로우를 커버할 수 있습니다.

## Pillars (고급)

`KAIRO_PUBLIC_SURFACE=pillars`로 활성화:

- 도구: `explore`, `understand`, `change`, `write`, `manage`
- 목표: per-pillar 옵션(프로파일/리밋/고급 설정)을 직접 제어

## 매핑: 의도 → 무엇을 호출할까

프레임워크 라우팅 휴리스틱(절대 규칙은 아님):

| 하고 싶은 것 | 우선 호출 | 비고 |
|---|---|---|
| 빠르게 저장소 이해 | `task({ mode:"ask"|"analyze" })` | 대부분의 워크플로우는 여기서 시작. |
| 더 깊은 근거 | `manage({ command:"artifact" })` | `task`가 가리키는 pack을 가져오기. |
| 안전한 편집 계획 | `task({ mode:"plan_change" })` | `draftId`(+ MCP 모드에서 `applyToken`) 생성. |
| 계획 적용 | `task({ mode:"apply_change" })` | 가능하면 `guidance.nextCalls` 그대로 실행. |
| 새 파일 생성(안전) | `task({ mode:"write", safety:"plan" })` | MCP 모드에서 2단계 흐름 권장. |
| write draft 적용 | `task({ mode:"write", safety:"apply" })` | MCP 모드에서 `draftId + applyToken` 필요. |
| 검색/탐색을 더 세밀하게 | `explore` / `understand` | per-tool 제어가 필요할 때. |
| 복잡한 편집 워크플로우 | `change` / `write` | pillars 쪽이 옵션이 더 풍부. |

정확한 계약/실패 모드는 아래 참고:

- [도구 레퍼런스](/ko/agent/TOOL_REFERENCE)
- [ADR-084](/adr/ADR-084-mcp-autopilot-and-preset-layer)
- [ADR-086](/adr/ADR-086-task-compact-change-write-verify)

