# Tools Reference

Kairo exposes three MCP tools over stdio (JSON-RPC 2.0).

---

## `kairo_search`

Hybrid semantic search over your codebase. Combines BM25 full-text and vector similarity via Reciprocal Rank Fusion (RRF).

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Natural language or keyword query |
| `scope` | string | `"code"` | Filter: `"code"`, `"docs"`, or `"all"` |
| `limit` | number | `10` | Max results |

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

### Search quality features

- **Scope-aware snippets** — results expand to enclosing function/struct boundaries
- **Filename boosting** — files whose name matches the query rank higher (2x for basename, 1.3x for directory)
- **Freshness indicator** — if the file watcher has pending changes, results include a note

---

## `kairo_status`

Check index health, trigger rebuilds, or download the embedding model.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `action` | string | `"check"` | `"check"`, `"reindex"`, or `"download-model"` |

### Actions

#### `check` (default)

```
kairo_status()
```

Shows document count, segments, vectors, graph size, embedding model state, file watcher state, and project root.

#### `reindex`

```
kairo_status(action: "reindex")
```

Full BM25 rebuild (synchronous) + dependency graph update + background vector embedding for changed files.

#### `download-model`

```
kairo_status(action: "download-model")
```

Downloads bge-small-en-v1.5 (~32MB) from HuggingFace Hub to `~/.kairo/models/`. Run `reindex` after to build vector embeddings.

---

## `kairo_graph`

Query the project dependency graph. Understand module dependencies, detect circular imports, trace impact paths.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | string | yes | `"deps"`, `"dependents"`, `"cycles"`, `"path"`, `"impact"` |
| `file` | string | for all except `cycles` | Relative file path |
| `target` | string | for `path` only | Destination file for path tracing |

### Operations

#### `deps` — what does this file import?

```
kairo_graph(operation: "deps", file: "src/mcp/mod.rs")
```

#### `dependents` — who imports this file?

```
kairo_graph(operation: "dependents", file: "src/common/fs.rs")
```

#### `cycles` — detect circular dependencies

```
kairo_graph(operation: "cycles")
```

Returns all circular dependency chains, or "No circular dependencies detected."

#### `path` — shortest import path between two files

```
kairo_graph(operation: "path", file: "src/main.rs", target: "src/common/fs.rs")
```

#### `impact` — transitive impact analysis

```
kairo_graph(operation: "impact", file: "src/common/fs.rs")
```

Shows all files affected by changes, grouped by depth (direct vs indirect). Uses BFS through reverse dependency edges with a max depth of 10.

### Language support

| Language | Extensions | Import patterns |
|----------|------------|-----------------|
| Rust | `.rs` | `use crate::`, `use super::`, `use self::` |
| TypeScript/JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` | `import from`, `require()`, `import()`, `export from` |
| Python | `.py` | `import`, `from ... import` (relative + absolute) |
| Go | `.go` | `import "..."`, multi-import blocks |
| PHP | `.php` | `use Namespace\Class`, `require`, `include` |

External dependencies (npm packages, crates.io, PyPI) are excluded — only intra-project edges are tracked.
