# Getting Started

## Requirements

- Rust 1.75+ (`rustup update stable`)
- An MCP-compatible host (Claude Code, Cursor, etc.)

## Build

```bash
git clone https://github.com/Meshyarn/kairo
cd kairo
cargo build --release
```

Binary: `target/release/kairo` (~26MB, no runtime dependencies)

## MCP Configuration

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

If `args` is empty, Kairo uses the current working directory.

### Cursor

`.cursor/mcp.json`:

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

## First Use

On first tool call, Kairo automatically:

1. Walks your project directory (respects `.gitignore`)
2. Builds a BM25 full-text index
3. Downloads `bge-small-en-v1.5` (~23MB) and builds a vector index
4. Builds a dependency graph

Index is stored in `.kairo/` in your project root. Subsequent startups load the cached index instantly.

## Verify

```
kairo_status()
```

Expected output:
```
Kairo v2.0.0-alpha.1 — indexed
Files: 231 | Chunks: 1847
Graph: 13 nodes, 17 edges
Embedding: ready (bge-small-en-v1.5, 384-dim)
```

## Reindex

```
kairo_status(action: "reindex")
```

Run this after large changes, or after adding/removing files.

## Logging

Set `RUST_LOG=info` (or `debug`) to see logs on stderr:

```bash
RUST_LOG=info kairo /path/to/project
```
