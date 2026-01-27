# Search & embeddings

Kairo supports lexical search (native core) and optional vector search (embeddings + index).

## Embeddings (optional)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_EMBEDDING_PROVIDER` | Select embedding backend (`local`, `remote`, `hash`, `disabled`). | `remote` is opt-in and enables downloads from HuggingFace. |
| `KAIRO_EMBEDDING_QUANTIZED` | Use quantized model (`true`/`false`). | Default: `true` (int8/q8). Set `false` for full precision (fp32/fp16). |
| `KAIRO_EMBEDDING_MODEL` | Bundled/local model identifier. | Default: `multilingual-e5-small`. |
| `KAIRO_MODEL_DIR` | Bundled model directory override. | No remote downloads. |
| `KAIRO_MODEL_CACHE_DIR` | Local model cache directory override. | Optional. |
| `KAIRO_EMBEDDING_E5_PREFIX` | Enable E5 `query:`/`passage:` prefixing. | Default: `true`. |

The local model folder name must match `KAIRO_EMBEDDING_MODEL`. See [Search & Embeddings](/guides/search-and-embeddings) for download/prep steps.

## Embeddings pack (P2 optional)

For large repos, persisting embeddings as a binary pack reduces restore time and disk footprint (vs legacy JSON+base64).

| Variable | Purpose |
|---|---|
| `KAIRO_EMBEDDING_PACK_FORMAT` | Enable pack persistence: `float32`, `q8`, or `both` (unset = disabled/legacy). |
| `KAIRO_EMBEDDING_PACK_REBUILD` | Policy: `auto` (migrate if pack missing), `on_start` (force rebuild from legacy), `manual` (no auto). |
| `KAIRO_EMBEDDING_PACK_INDEX` | Index format: `json` (default) or `bin` (binary index for large packs). |
| `KAIRO_VECTOR_CACHE_MB` | Max MB for the on-demand embedding vector cache. |

Use `kairo-migrate-embeddings-pack` to migrate legacy `.kairo/storage/embeddings.json` into `.kairo/storage/v1/embeddings/<provider>/<model>/`.
To auto-migrate at startup when legacy embeddings exist, set `KAIRO_EMBEDDING_PACK_REBUILD=auto` (or `on_start` to force rebuild).

## Packaging local models (release artifacts)

These knobs are used during bundling:

| Variable | Purpose |
|---|---|
| `KAIRO_MODEL_SOURCE` | Source directory for local models during bundling. |
| `KAIRO_MODEL_BUNDLE_PROFILE` | `minimal` (default) vs `full`. |
| `KAIRO_SKIP_MODEL_BUNDLE` | Skip bundling (dev-only). |

## Vector index (P1)

| Variable | Purpose |
|---|---|
| `KAIRO_VECTOR_INDEX` | Vector index backend (`auto`, `off`, `bruteforce`, `hnsw`). |
| `KAIRO_VECTOR_INDEX_REBUILD` | Rebuild policy (`auto`, `on_start`, `manual`). |
| `KAIRO_VECTOR_INDEX_SHARDS` | Shard count for large repos (`off`, `auto`, or a number). |
| `KAIRO_VECTOR_INDEX_MAX_POINTS` | Index size cap for ANN builds. |
| `KAIRO_VECTOR_INDEX_M` | HNSW M parameter. |
| `KAIRO_VECTOR_INDEX_EF_CONSTRUCTION` | HNSW build parameter. |
| `KAIRO_VECTOR_INDEX_EF_SEARCH` | HNSW search parameter. |

When `KAIRO_VECTOR_INDEX_REBUILD=manual`, use the CLI `kairo-build-vector-index`.

## Native search (ADR-085)

Kairo’s file/doc search is powered by Tantivy via the native module (`@kairo/core-rs`). The legacy Trigram index is removed.

- ADR summary: [ADR-085](/adr/ADR-085-rust-native-search-core-tantivy)
- Index directory: `${KAIRO_DIR}/data/index[/repos/<repoId>]/v2-tantivy`
- Inspect health: `manage({ command: "status" })` → `nativeSearch.available`, `nativeSearch.stats.docCount`, `nativeSearch.stats.writeEnabled` (false when the index is opened read-only due to a writer lock)
- Rebuild: `manage({ command: "reindex" })`

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_RUST_CORE_ENABLED` | Enable/disable the Rust core (includes native search). | Default `true`. |

For the full details and commands, see:

- [Getting Started](/guides/getting-started)
- [Configuration (all env vars)](/guides/configuration)
