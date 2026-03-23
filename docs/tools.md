# Tools Reference

Kairo exposes three MCP tools over stdio (JSON-RPC 2.0).

---

## `kairo_search`

Hybrid semantic search over your codebase. Combines BM25 full-text and vector similarity via Reciprocal Rank Fusion (RRF).

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Natural language or keyword query |
| `scope` | string | `"all"` | Filter: `"code"`, `"docs"`, or `"all"` |
| `limit` | number | `10` | Max results (1–50) |

### Examples

```
# Find by concept
kairo_search(query: "retry logic with exponential backoff")

# Find by keyword with scope filter
kairo_search(query: "authentication middleware", scope: "code")

# Find docs
kairo_search(query: "configuration options", scope: "docs", limit: 5)
```

### When to use instead of Grep

- Searching for a concept you can't name exactly ("connection pooling", "error recovery")
- Finding implementations across different naming conventions
- Semantic similarity ("how is X done here?")

Grep is better for exact string matches, symbol lookups, or when you know the precise identifier.

### Result format

```json
{
  "results": [
    {
      "file": "src/search/indexer.rs",
      "score": 0.92,
      "lines": "45-78",
      "snippet": "..."
    }
  ],
  "query": "retry logic",
  "total": 7
}
```

---

## `kairo_status`

Check index health or trigger a full rebuild.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `action` | string | `"status"` | `"status"` or `"reindex"` |

### Examples

```
# Check status
kairo_status()

# Rebuild index
kairo_status(action: "reindex")
```

### Status output

```
Kairo v2.0.0-alpha.1 — indexed
Files: 231 | Chunks: 1847
Graph: 13 nodes, 17 edges
Embedding: ready (bge-small-en-v1.5, 384-dim)
```

---

## `kairo_graph`

Query the project dependency graph. Use when you need to understand which files import what, detect circular dependencies, or trace the impact path between two files.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | string | yes | `"deps"`, `"dependents"`, `"cycles"`, `"path"` |
| `file` | string | for `deps`, `dependents`, `path` | Relative file path |
| `target` | string | for `path` | Destination file for path tracing |

### Operations

#### `deps` — what does this file import?

```
kairo_graph(operation: "deps", file: "src/mcp/mod.rs")
```

```
src/mcp/mod.rs imports:
  src/common/fs.rs
  src/graph/store.rs
  src/search/indexer.rs
  src/search/embedder.rs
  (+ 2 more)
```

#### `dependents` — who imports this file?

```
kairo_graph(operation: "dependents", file: "src/common/fs.rs")
```

```
src/common/fs.rs is imported by:
  src/mcp/mod.rs
  src/search/indexer.rs
  src/search/embedder.rs
  src/graph/store.rs
```

#### `cycles` — detect circular dependencies

```
kairo_graph(operation: "cycles")
```

Returns all circular dependency chains, or "No cycles detected."

#### `path` — shortest import path between two files

```
kairo_graph(operation: "path", file: "src/main.rs", target: "src/common/fs.rs")
```

```
src/main.rs → src/mcp/mod.rs → src/common/fs.rs
```

### Language support

| Language | Extensions | Import patterns |
|----------|------------|-----------------|
| Rust | `.rs` | `use crate::`, `use super::` |
| TypeScript/JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` | `import from`, `require()` |
| Python | `.py` | `import`, `from ... import` |
| Go | `.go` | `import "..."`, multi-import blocks |

External dependencies (npm packages, crates.io, PyPI) are excluded — only intra-project edges are tracked.
