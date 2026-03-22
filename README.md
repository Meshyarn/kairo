# Kairo

Semantic code intelligence for AI agents — an MCP server powered by Tantivy.

Kairo fills the gaps that AI coding agents (Claude Code, Copilot, etc.) can't cover natively:

- **Concept search** — find code by meaning, not just keywords
- **Impact analysis** — predict what breaks when you change something *(coming soon)*
- **Project graphs** — understand module dependencies at a glance *(coming soon)*

## Quick Start

```bash
# Build
cargo build --release

# The binary is at target/release/kairo
```

### Claude Code

Add to your MCP config (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "kairo": {
      "command": "/path/to/kairo",
      "args": []
    }
  }
}
```

Kairo automatically indexes your project on first use. No configuration needed.

## Tools

### `kairo_search`

Find code by concept, not just keywords. Use when Grep misses results.

```
kairo_search(query: "retry logic with backoff")
kairo_search(query: "authentication middleware", scope: "code")
kairo_search(query: "API rate limiting", limit: 5)
```

**When to use instead of Grep:**
- Searching for a concept: "error handling", "database connection pooling"
- Looking for code you can't name exactly
- Finding related implementations across different naming conventions

### `kairo_status`

Check index health or trigger reindexing.

```
kairo_status()                    # check status
kairo_status(action: "reindex")   # rebuild index
```

## Architecture

Full Rust. Single binary. No runtime dependencies.

- **Search engine:** Tantivy (BM25F full-text index)
- **MCP protocol:** rmcp SDK (JSON-RPC over stdio)
- **File walking:** `ignore` crate (respects .gitignore)

## v1 Archive

The original TypeScript + Rust hybrid implementation (v1) is preserved in `.archive/v1/` along with 91 Architecture Decision Records in `docs/adr/`. These document the journey from a full orchestration server to this focused intelligence tool.

## License

MIT
