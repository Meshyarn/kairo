# 에이전트 프레임워크 패턴

도구 호출을 라우팅하는 프레임워크를 만든다면, Kairo는 아래 “통합 포지션”을 전제로 설계되어 있습니다.

## 기본 포지션: 호출 빈도(신뢰)를 최우선

Do:

- `KAIRO_PUBLIC_SURFACE=compact`를 기본으로 하고, 대부분의 의도를 `task`로 라우팅
- apply 전까지는 **읽기 전용(side-effect-free)**으로 취급
- `guidance.nextCalls`가 있으면 가능한 한 그대로 실행(배선 오류 감소)

Avoid:

- Kairo가 유용해지기 위해 특수한 시스템 프롬프트가 필수인 구조
- 초기부터 도구 표면을 크게 확장하는 접근(제네릭 호스트 안정성↓)

## 권장 라우팅 규칙

1. “이해/근거가 필요” → `task`
2. “더 깊은 증거가 필요” → `manage artifact`
3. “안전한 편집이 필요” → `task plan_change` → `task apply_change`
4. “더 많은 옵션이 필요” → pillars(`explore/understand/change/write`)로 전환

## 프레임워크가 강제해야 하는 신뢰성 규칙

- apply는 serialize(토큰은 1회성)
- stdout를 깨끗하게 유지(MCP 프레임 보호)
- 멀티스텝 편집에서 `sessionId` 유지

더 깊은 근거:

- [도구 레퍼런스](/ko/agent/TOOL_REFERENCE)
- [ADR-084](/adr/ADR-084-mcp-autopilot-and-preset-layer)
- [ADR-088](/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program)

