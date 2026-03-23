# Kairo

Semantic code intelligence for AI agents — an MCP server powered by Tantivy.

Kairo fills the gaps that AI coding agents (Claude Code, Copilot, etc.) can't cover natively:

- **Concept search** — find code by meaning, not just keywords
- **Dependency graph** — understand module dependencies, detect cycles, trace impact paths
- **Impact analysis** — predict what breaks when you change something *(coming soon)*

## Quick Start

```bash
cargo build --release
# Binary: target/release/kairo
```

### Claude Code

`.claude/settings.json`:

```json
{
  "mcpServers": {
    "kairo": {
      "command": "/absolute/path/to/kairo",
      "args": ["/path/to/your/project"]
    }
  }
}
```

Kairo indexes your project on first use. No further configuration needed.

## Tools

### `kairo_search`

Hybrid semantic search (BM25 + vector, fused with RRF). Use when Grep misses results.

```
kairo_search(query: "retry logic with backoff")
kairo_search(query: "authentication middleware", scope: "code")
kairo_search(query: "API rate limiting", limit: 5)
```

### `kairo_graph`

Query the project dependency graph.

```
kairo_graph(operation: "deps", file: "src/mcp/mod.rs")
kairo_graph(operation: "dependents", file: "src/common/fs.rs")
kairo_graph(operation: "cycles")
kairo_graph(operation: "path", file: "src/main.rs", target: "src/common/fs.rs")
```

### `kairo_status`

Check index health or trigger a full rebuild.

```
kairo_status()
kairo_status(action: "reindex")
```

## Docs

- [Getting Started](docs/getting-started.md)
- [Tools Reference](docs/tools.md)
- [Architecture](docs/architecture.md)

## Architecture

Single Rust binary (~26MB). No runtime dependencies.

- **Search:** Tantivy BM25F + bge-small-en-v1.5 vectors, RRF fusion
- **Graph:** regex-based import extraction, adjacency list, DFS/BFS algorithms
- **Protocol:** rmcp 0.16, JSON-RPC 2.0 over stdio

## License

MIT
