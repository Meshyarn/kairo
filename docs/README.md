# Kairo Docs

This folder contains the minimal docs needed to run `kairo` and connect it to an MCP host.

## Start here

- `docs/guides/getting-started.md` — build/run + connect from CLI agents (Claude CLI / Gemini CLI / Codex CLI)
- `docs/guides/configuration.md` — environment variables (minimal + accurate)
- `docs/guides/promptless-integration.md` — minimal MCP setup without custom prompts
- `docs/guides/ops-runbook.md` — launch checklist + post-launch iteration loop

For quick validation from source, see:
- `npm run smoke:mcp-mock-client`
- `npm run benchmark:adr-085-search-slo`
- `npm run smoke:adr-088-compact-guidance`
- `npm run smoke:adr-088-stdio-guidance-closure`
- `npm run smoke:adr-088-change-write-minimal-apply`
- `npm run smoke:adr-088-change-write-deep`
- `npm run benchmark:adr-088-search-accuracy`

## Agent docs (recommended)

- `docs/agent/TOOL_REFERENCE.md` — public tool input reference (`task`/`manage` + pillars)
- `docs/agent/AGENT_PLAYBOOK.md` — recommended usage patterns (evidence packs + compact follow-ups)

## Architecture (curated ADRs)

- `docs/adr/README.md` — curated ADR index + summaries
- `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md` — promptless MCP defaults (`task` + presets + handshake)
- `docs/adr/ADR-085-rust-native-search-core-tantivy.md` — native search core (Tantivy via `@kairo/core-rs`)
- `docs/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program.md` — agent trust verification program (E2E harnesses + CI gates)

More detailed references beyond these curated ADRs are intentionally kept out of the OSS docs set for now.
