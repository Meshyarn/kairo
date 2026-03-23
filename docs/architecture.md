# Architecture

Kairo v2 is a single Rust binary that speaks the MCP protocol over stdio.

## Overview

```
AI Agent (Claude, Cursor, etc.)
    │  JSON-RPC 2.0 over stdio
    ▼
┌─────────────────────────────────┐
│           MCP Server            │  rmcp 0.16
│  kairo_search / kairo_status /  │
│         kairo_graph             │
└──────────┬──────────────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
Search         Graph
Index          Store
    │             │
    ▼             ▼
.kairo/        .kairo/
tantivy/       graph.json
vectors/
```

## Search Index

Hybrid search combining two retrieval methods, fused with Reciprocal Rank Fusion (RRF, k=60):

### BM25 (full-text)

- Engine: [Tantivy](https://github.com/quickwit-oss/tantivy) 0.22
- Scoring: BM25F with field boosts — `symbols ×12`, `basename ×6`, `content ×1`
- Indexed fields: file content chunked by function/block boundaries, symbol names, basename
- Persisted to `.kairo/tantivy/`

### Vector (semantic)

- Model: `bge-small-en-v1.5` (384-dim, ~23MB, downloaded on first use via HuggingFace Hub)
- Runtime: ONNX Runtime via `ort` crate
- Tokenizer: `tokenizers` crate (Rust-native, no Python)
- Similarity: cosine distance
- Persisted to `.kairo/vectors/`

### RRF Fusion

Both retrievers produce ranked lists; RRF merges them:

```
score(d) = Σ 1 / (k + rank(d))   where k=60
```

This is robust to score scale differences between BM25 and cosine similarity.

## Dependency Graph

- **Extraction:** regex-based per-language import parsing (no AST/tree-sitter)
- **Resolution:** best-effort specifier → relative file path mapping
- **Storage:** adjacency list (`HashMap<String, HashSet<String>>`), persisted to `.kairo/graph.json`
- **Incremental:** content hashes compared on reindex; only changed files re-parsed
- **Algorithms:** DFS coloring for cycle detection, BFS for shortest path

### Supported languages

| Language | Pattern |
|----------|---------|
| Rust | `use crate::*`, `use super::*` |
| TS/JS | `import from "..."`, `require("...")` |
| Python | `import x`, `from x import y` |
| Go | `import "..."`, multi-import blocks |

External dependencies are excluded (bare module names, crates without `crate::` prefix, etc.).

## File Walking

Uses the [`ignore`](https://crates.io/crates/ignore) crate — same library as `ripgrep`. Automatically respects:

- `.gitignore`
- `.ignore`
- Global git ignores

`.kairo/` itself is excluded from indexing.

## MCP Protocol

- Transport: stdio (JSON-RPC 2.0)
- SDK: `rmcp` 0.16
- All logging goes to stderr; stdout is reserved for MCP protocol messages
- Tool definitions use `#[tool]` proc macros from rmcp

## Concurrency

- Embedding model runs on a background `spawn_blocking` thread
- Index reads use `try_lock` to avoid blocking on embedding model startup
- `Arc<Mutex<T>>` for shared state between tools

## Storage Layout

```
.kairo/
├── tantivy/        # Tantivy BM25 index segments
├── vectors/        # Raw f32 embeddings + file metadata
│   ├── embeddings.bin
│   └── metadata.json
└── graph.json      # Dependency graph (JSON)
```

All artifacts are local to the project root. No global state, no daemon.
