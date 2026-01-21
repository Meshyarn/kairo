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

## Agent docs (recommended)

- `docs/agent/TOOL_REFERENCE.md` — public tool input reference (`task`/`manage` + pillars)
- `docs/agent/AGENT_PLAYBOOK.md` — recommended usage patterns

## Architecture (curated ADRs)

- `docs/adr/README.md` — curated ADR index + summaries
- `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md` — promptless MCP defaults (`task` + presets + handshake)

More detailed references beyond these curated ADRs are intentionally kept out of the OSS docs set for now.
