# Getting Started

## Requirements

- Rust 1.75+ (`rustup update stable`)
- An MCP-compatible host (Claude Code, Cursor, etc.)

## Install

```bash
# Option 1: Install from GitHub
cargo install --git https://github.com/Meshyarn/kairo.git

# Option 2: Clone and build
git clone https://github.com/Meshyarn/kairo.git
cd kairo
cargo build --release
# Binary: target/release/kairo (~26MB, no runtime dependencies)
```

## MCP Configuration

### Claude Code

Add to `.claude/settings.json` (project-level) or `~/.claude/settings.json` (global):

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

If `args` is empty, Kairo uses the current working directory.

### Claude Desktop

Add to `claude_desktop_config.json`:

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
2. Builds a BM25 full-text index (instant)
3. Builds a dependency graph (instant)
4. Loads the embedding model if available (background)
5. Starts a file watcher for real-time incremental updates

Index is stored in `.kairo/` in your project root. Subsequent startups load the cached index instantly.

### Embedding Model

If you cloned with Git LFS, the bundled bge-small-en-v1.5 model is used automatically. Otherwise, enable hybrid search with:

```
kairo_status(action: "download-model")
kairo_status(action: "reindex")
```

Without the model, Kairo runs in BM25-only mode (still effective for keyword search).

## Verify

```
kairo_status()
```

Expected output:
```
Kairo Index Status:
- Documents: 227
- Segments: 3
- Vectors: 343
- Graph: 13 nodes, 17 edges
- Embedding model: loaded
- Embedding task: idle
- File watcher: active
- Root: /path/to/project
```

## Reindex

```
kairo_status(action: "reindex")
```

The file watcher handles incremental updates automatically. Manual reindex is only needed after bulk operations like `git checkout` to a very different branch.

## Logging

Set `RUST_LOG=info` (or `debug`) to see logs on stderr:

```bash
RUST_LOG=info kairo /path/to/project
```
