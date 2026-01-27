# 운영(Ops)

이 섹션은 실제 에이전트/운영 환경에서 Kairo를 안정적으로 돌리기 위한 가이드입니다.

여기서 시작:

- [운영 런북](/ko/guides/ops-runbook)
- [로깅 & 텔레메트리](/ko/reference/configuration/logging-and-telemetry)

운영 관점 핵심:

- stdout를 깨끗하게 유지(MCP 프레이밍),
- “blocked” vs “호스트 배선 문제”를 구분할 수 있는 진단 수집,
- 반복 가능한 하네스로 지연/메모리 회귀를 측정.

신뢰 검증 하네스/CI 게이트는 아래 참고:

- [ADR-088](/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program)

