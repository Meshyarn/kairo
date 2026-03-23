# Architecture

Kairo v2 is a single Rust binary that speaks the MCP protocol over stdio.

## Overview

```
AI Agent (Claude Code, Cursor, etc.)
    │  JSON-RPC 2.0 over stdio
    ▼
┌─────────────────────────────────┐
│           MCP Server            │  rmcp 0.16
│  kairo_search / kairo_status /  │
│         kairo_graph             │
└──────────┬──────────────────────┘
           │
    ┌──────┼──────┐
    │      │      │
    ▼      ▼      ▼
Search   Graph   File
Index    Store   Watcher
    │      │      │
    ▼      ▼      │
.kairo/  .kairo/  └──► incremental
tantivy/ graph.json    updates to
vectors/               index + graph
```

## Search Index

Hybrid search combining two retrieval methods, fused with Reciprocal Rank Fusion (RRF, k=60):

### BM25 (full-text)

- Engine: [Tantivy](https://github.com/quickwit-oss/tantivy) 0.22
- Scoring: BM25F with field boosts — `symbols ×12`, `basename ×6`, `content ×1`
- Intent detection: query analysis selects optimal boost weights (path, symbol, general)
- Post-BM25 filename boosting: basename match ×2, directory match ×1.3
- Persisted to `.kairo/tantivy/`

### Vector (semantic)

- Model: `bge-small-en-v1.5` (384-dim, ~32MB int8 quantized)
- Bundled in repo via Git LFS, or downloaded on demand from HuggingFace Hub
- Runtime: ONNX Runtime via `ort` crate (CPU, Level3 optimization)
- Tokenizer: `tokenizers` crate (Rust-native, no Python)
- Similarity: cosine distance
- Persisted to `.kairo/vectors/`

### RRF Fusion

Both retrievers produce ranked lists; RRF merges them:

```
score(d) = Σ 1 / (k + rank(d))   where k=60
```

This is robust to score scale differences between BM25 and cosine similarity.

## File Watcher

Real-time incremental indexing powered by `notify` v7:

- **Detection:** recursive filesystem watching (FSEvents on macOS, inotify on Linux, ReadDirectoryChanges on Windows)
- **Debouncing:** 150ms window, batches rapid saves into single updates
- **Processing:** changed files update both BM25 index and dependency graph incrementally
- **Filtering:** respects same rules as initial walk (gitignore, extension whitelist, size limit, skip dirs)
- **Non-blocking:** runs in a background tokio task, doesn't slow MCP responses

## Dependency Graph

- **Extraction:** regex-based per-language import parsing (no AST/tree-sitter)
- **Resolution:** best-effort specifier → relative file path mapping
- **Storage:** adjacency list (`HashMap<String, HashSet<String>>`), persisted to `.kairo/graph.json`
- **Incremental:** content hashes compared on update; only changed files re-parsed
- **Algorithms:** DFS coloring for cycle detection, BFS for shortest path, BFS for transitive impact

### Supported languages

| Language | Patterns |
|----------|----------|
| Rust | `use crate::*`, `use super::*`, `use self::*` (module-hierarchy aware) |
| TS/JS | `import from "..."`, `require("...")`, `import("...")`, `export from` |
| Python | `import x`, `from x import y` (relative + absolute) |
| Go | `import "..."`, multi-import blocks |
| PHP | `use Namespace\Class`, `require`/`include`/`require_once`/`include_once` |

External dependencies are excluded (bare module names, crates without `crate::` prefix, etc.).

## File Walking

Uses the [`ignore`](https://crates.io/crates/ignore) crate — same library as `ripgrep`. Automatically respects:

- `.gitignore`
- `.ignore`
- Global git ignores

Skipped directories: `node_modules`, `target`, `.git`, `.archive`, `__pycache__`, `.venv`, `vendor`, `dist`, `build`, `.next`, `.kairo`

Indexes 35+ file extensions across all major languages, config files, and documentation formats.

## MCP Protocol

- Transport: stdio (JSON-RPC 2.0)
- SDK: `rmcp` 0.16
- All logging goes to stderr; stdout is reserved for MCP protocol messages
- Tool definitions use `#[tool]` proc macros from rmcp

## Concurrency

- Embedding runs on a background `spawn_blocking` thread (per-batch locking)
- File watcher runs in a background tokio task
- Index reads use `try_lock` to avoid blocking during embedding
- `Arc<Mutex<T>>` for shared state between tools

## Storage Layout

```
.kairo/
├── index/          # Tantivy BM25 index segments
├── vectors/        # Raw f32 embeddings + metadata
│   ├── vectors.bin
│   └── vectors.meta.json
├── graph.json      # Dependency graph (adjacency list + file hashes)
└── file_hashes.json # Content hashes for incremental indexing
```

All artifacts are local to the project root. No global state, no daemon.

## Cross-Platform

Kairo builds and runs on macOS, Linux, and Windows:

- `notify` v7: platform-native filesystem events (FSEvents, inotify, ReadDirectoryChanges)
- `ort`: downloads pre-built ONNX Runtime for the target platform
- All path operations use `std::path` abstractions
- No platform-specific conditional compilation
