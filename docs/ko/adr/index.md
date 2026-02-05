# 아키텍처 (ADR)

에이전트 프레임워크에 Kairo를 통합한다면, 아래 ADR들은 안정 계약(stable contract)과 그 배경을 설명합니다.

세 개만 읽는다면:

- **ADR-084**: “compact surface”가 왜 필요한지 (프롬프트리스 기본값 + preset 레이어)
- **ADR-086**: compact change/write/verify 핸드셰이크 (`draftId` + `applyToken`)
- **ADR-088**: agent trust 검증 프로그램 (harnesses + SLO gates)

따옴표/이스케이프가 복잡한 템플릿을 자주 다룬다면 추가로:

- **ADR-089**: `change`/`write` 원문 소스(ContentSource) 계약 (따옴표/이스케이프 깨짐 방지)
- **ADR-090**: adoption/UX/docs drift 로드맵 (WP1–WP8)

- [Curated ADR Index](/ko/adr/README)
- [ADR-084 — MCP autopilot & preset layer](/adr/ADR-084-mcp-autopilot-and-preset-layer)
- [ADR-086 — Compact `task` change/write/verify contract](/adr/ADR-086-task-compact-change-write-verify)
- [ADR-088 — Agent trust E2E verification program](/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program)
- [ADR-087 — Adaptive LOD & evidence packs](/adr/ADR-087-task-adaptive-lod-and-evidence-pack)
- [ADR-089 — Raw content sources for change/write](/adr/ADR-089-raw-content-sources-for-change-write)
- [ADR-090 — 8-step adoption/UX/docs drift roadmap](/adr/ADR-090-8-step-roadmap-ux-doc-quality)
