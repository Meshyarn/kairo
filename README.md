# Kairo

Semantic code intelligence for AI agents — an MCP server powered by Tantivy.

Kairo fills the gaps that AI coding agents (Claude Code, Copilot, etc.) can't cover natively:

- **Concept search** — find code by meaning, not just keywords (BM25 + vector hybrid)
- **Dependency graph** — understand module dependencies, detect cycles, trace import paths
- **Impact analysis** — predict what breaks when you change a file (transitive propagation)
- **File watcher** — real-time incremental indexing as you edit

## Install

```bash
# From source (requires Rust toolchain)
cargo install --git https://github.com/Meshyarn/kairo.git

# Or clone and build
git clone https://github.com/Meshyarn/kairo.git
cd kairo
cargo build --release
# Binary: target/release/kairo
```

## MCP Configuration

### Claude Code

Add to `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

```json
{
  "mcpServers": {
    "kairo": {
      "command": "kairo",
      "args": []
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kairo": {
      "command": "/path/to/kairo",
      "args": ["/path/to/your/project"]
    }
  }
}
```

Kairo indexes your project on first use. No further configuration needed.

### Optional: Vector Embeddings

Kairo includes a bundled bge-small-en-v1.5 model for hybrid search. If installed from source without Git LFS, enable it with:

```
kairo_status(action: "download-model")
kairo_status(action: "reindex")
```

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
kairo_graph(operation: "impact", file: "src/common/fs.rs")
```

### `kairo_status`

Check index health, trigger rebuilds, or download the embedding model.

```
kairo_status()
kairo_status(action: "reindex")
kairo_status(action: "download-model")
```

## Supported Languages

Import extraction and dependency graph support:

| Language | Import Patterns |
|----------|----------------|
| Rust | `use crate::`, `use super::`, `use self::` |
| TypeScript/JavaScript | `import from`, `require()`, `import()`, `export from` |
| Python | `import`, `from ... import` (relative + absolute) |
| Go | `import "..."`, `import (...)` |
| PHP | `use Namespace\Class`, `require`, `include` |

Search indexing covers 35+ file extensions (all major languages, config files, docs).

## Architecture

Single Rust binary (~26MB). No runtime dependencies.

- **Search:** Tantivy BM25F + bge-small-en-v1.5 vectors (384-dim), RRF fusion (k=60)
- **Graph:** regex-based import extraction, adjacency list, BFS/DFS
- **Watcher:** notify v7, 150ms debounce, incremental index + graph updates
- **Protocol:** rmcp 0.16, JSON-RPC 2.0 over stdio

## License

MIT
