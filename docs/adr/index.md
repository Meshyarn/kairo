# Architecture (ADRs)

If you’re integrating Kairo into an agent framework, these ADRs describe the stable contracts and why they exist.

If you only read three:

- **ADR-084**: why “compact surface” exists (promptless defaults + preset layer)
- **ADR-086**: compact change/write/verify handshake (draftId + applyToken)
- **ADR-088**: agent trust verification program (harnesses + SLO gates)

If you frequently edit quote/escape-heavy templates, also read:

- **ADR-089**: raw content sources for `change`/`write` (no quote/escape breakage)

- [Curated ADR Index](/adr/README)
- [ADR-084 — MCP autopilot & preset layer](/adr/ADR-084-mcp-autopilot-and-preset-layer)
- [ADR-086 — Compact `task` change/write/verify contract](/adr/ADR-086-task-compact-change-write-verify)
- [ADR-088 — Agent trust E2E verification program](/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program)
- [ADR-087 — Adaptive LOD & evidence packs](/adr/ADR-087-task-adaptive-lod-and-evidence-pack)
- [ADR-089 — Raw content sources for change/write](/adr/ADR-089-raw-content-sources-for-change-write)
