# kairo

> A symbiotic MCP server for Vibe Coding. Syncs architectural intent, project context, and coding style with any AI agent.

`kairo` is a local-first Model Context Protocol (MCP) server that exposes a small, intent-based tool surface for agents to explore, understand, and safely change code.

## Why kairo

- Syncs architecture intent + constraints with edits (guardrails before apply)
- Builds project-aware context from code + docs (fast search + structured reads)
- Learns and applies repo coding style/patterns for consistent output
- Captures Writer’s Flow artifacts (research/style/draft/review) with session chaining
- Emphasizes safe changes (dry-run, validation, backups/transactions where applicable)
- Improves change reliability via StrategySearch (Best-of-N / MCTS candidate scoring; opt-in)
- **Native Core (v0.6.0+)**: Tantivy-backed native search + Rust-accelerated chunking/diff/syntax to keep latency and heap stable on large repos.

## Quickstart (from source)

Prereqs: Node.js (see `package.json` engines, if present)

```bash
npm ci
npm run build
node dist/index.js --root /absolute/path/to/your/project
```

If you see `CAP_NATIVE_SEARCH_UNAVAILABLE`, build the native module (`@kairo/core-rs`) for your platform:

```bash
npm run build:core-rs
```

By default, runtime data is stored under `.kairo/` in the target project root.

## MCP defaults (promptless-friendly)

By default (`KAIRO_MODE=mcp`), Kairo exposes a **compact** tool surface: `task` + `manage`.
If you want direct control, set `KAIRO_PUBLIC_SURFACE=pillars` to expose the Five Pillars (`explore`/`understand`/`change`/`write`/`manage`).

For host config templates and troubleshooting, see `docs/guides/promptless-integration.md`.

## Docs

- `docs/README.md`
- `docs/agent/AGENT_PLAYBOOK.md`
- `docs/agent/TOOL_REFERENCE.md`
- `docs/adr/README.md`

## Use with CLI agents (Claude CLI / Gemini CLI / Codex CLI)

In your CLI’s MCP configuration, add a server that runs `kairo` over stdio:

- **Name:** `kairo`
- **Command:** `node`
- **Args:** `/absolute/path/to/kairo/dist/index.js --root /absolute/path/to/your/project`
- **Env (optional):**
  - `KAIRO_MODE=mcp`
  - `KAIRO_PUBLIC_SURFACE=compact`
  - `KAIRO_TOOL_SCHEMA_MODE=compat`
  - `KAIRO_LOG_TO_FILE=true`
  - `KAIRO_ALLOW_STDOUT_LOGS=false`
  - `KAIRO_LOG_LEVEL=info` (optional)

If your CLI supports per-server permissions, prefer read-only by default and grant write only when you intend to apply changes.

## Data directory

`kairo` writes indexes/caches/logs under `.kairo/` (including the native search index under `.kairo/data/index/.../v2-tantivy`). Add it to `.gitignore` (this repo already does).

## License

MIT (see `LICENSE`).
