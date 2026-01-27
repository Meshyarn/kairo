# Search & Embeddings (Offline-first)

This guide explains how Kairo’s search works (lexical + optional vector search), and how to run the embeddings stack **offline-first**.

If you only want the configuration knobs (env vars), see:

- [Search & embeddings config](/reference/configuration/search-and-embeddings)

## Mental model

Kairo combines two search layers:

- **Lexical search** (fast, reliable): backed by the native core (`@kairo/core-rs` / Tantivy).
- **Vector search** (semantic): optional; requires embeddings and (optionally) a vector index.

Offline baseline:

- **Baseline-A (core)**: runs without network even if embeddings are `hash`/`disabled`.
- **Baseline-B (embeddings-ready)**: local model files are present so vector search works offline.

## Choose an embeddings posture

| Goal | Suggested posture | Notes |
|---|---|---|
| "Works everywhere, no model files" | `KAIRO_EMBEDDING_PROVIDER=hash` | Lowest friction; semantic quality is limited. |
| "Strict offline, best default" | `KAIRO_EMBEDDING_PROVIDER=local` | Requires local model assets. |
| "Allow runtime downloads" | `KAIRO_EMBEDDING_PROVIDER=remote` | Explicit opt-in; depends on network policy. |
| "Disable vectors entirely" | `KAIRO_EMBEDDING_PROVIDER=disabled` | Lexical search only. |

### Why these defaults?

- **`hash` (default in dev)**: Most pragmatic for quick testing. Hashing enables caching without embeddings overhead.
- **`local` (recommended for production)**: Offline-capable and predictable. Plan model packaging upfront.
- **`disabled`**: Safest for strict air-gapped environments. Lexical search alone covers ~80% of real queries.


## Prepare a local embedding model (offline)

Kairo is offline-first by default. Runtime downloads are disabled unless you explicitly opt into `KAIRO_EMBEDDING_PROVIDER=remote`.

Recommended source: `Xenova/multilingual-e5-small` (ONNX + tokenizer files compatible with `@xenova/transformers`).

### Install HuggingFace CLI (if needed)

If you don't have `huggingface-cli`, install it first:

```bash
# Using pip
pip install huggingface-hub

# Using npm (if you prefer Node.js)
npm install -g huggingface-hub
```

Verify installation:
```bash
huggingface-cli --version
```

### Download the model

On a machine with internet access:

```bash
huggingface-cli download Xenova/multilingual-e5-small \
  --local-dir /tmp/models/multilingual-e5-small \
  --local-dir-use-symlinks false
```

This downloads ~350MB of model files.


Copy the folder to your offline machine. The model directory should look like:

```
models/
  multilingual-e5-small/
    config.json
    tokenizer.json
    tokenizer_config.json
    special_tokens_map.json    (optional)
    onnx/
      model.onnx
      model_quantized.onnx     (recommended)
```

Notes:

- The folder name must match `KAIRO_EMBEDDING_MODEL` (default: `multilingual-e5-small`).
- If you use a different model, ensure it ships ONNX + tokenizer assets compatible with `@xenova/transformers`.

## Bundle the offline model into release artifacts

When creating a release artifact, bundle the local model into `dist/models`:

```bash
# Point to a local model folder (either the model root, or a parent containing it)
KAIRO_MODEL_SOURCE=/path/to/models \
KAIRO_EMBEDDING_MODEL=multilingual-e5-small \
npm run bundle:models
```

Notes:

- Bundling uses the **minimal** profile by default (required tokenizer/config + one ONNX file).
  Set `KAIRO_MODEL_BUNDLE_PROFILE=full` to include all ONNX variants.
- `npm pack` / `npm publish` runs bundling automatically via `prepack`.
- Set `KAIRO_SKIP_MODEL_BUNDLE=true` to skip bundling (dev-only).

## Enable vector search

Vector search is useful when semantic recall matters (e.g., "find similar patterns", "concept-level lookup").

### Key settings explained

| Setting | Default | Why |
|---------|---------|-----|
| `KAIRO_EMBEDDING_PROVIDER` | `hash` | `hash` is fast and requires no setup. Upgrade to `local` when semantic search matters. |
| `KAIRO_EMBEDDING_MODEL` | `multilingual-e5-small` | Small (~350MB), multilingual, works offline. Good balance of speed vs. quality. |
| `KAIRO_MODEL_DIR` | `./models` (relative to root) | Lets different projects carry their own models without conflicts. |
| `KAIRO_VECTOR_INDEX` | `auto` | Falls back to brute-force if no prebuilt index. Set `hnsw` + `KAIRO_VECTOR_INDEX_REBUILD=manual` for large repos. |

Full reference: [Search & embeddings config](/reference/configuration/search-and-embeddings)

## Build the embeddings pack

For large repos, persisting embeddings as a binary pack reduces restore time and disk footprint.


```bash
# float32 (safe default)
KAIRO_EMBEDDING_PACK_FORMAT=float32 \
kairo-migrate-embeddings-pack

# or store both float32 + q8
KAIRO_EMBEDDING_PACK_FORMAT=both \
kairo-migrate-embeddings-pack
```

Notes:

- Pass `--force` to overwrite an existing pack.
- Pack files are stored under `.kairo/storage/v1/embeddings/<provider>/<model>/`.
- For very large packs, set `KAIRO_EMBEDDING_PACK_INDEX=bin` to use the binary index.
- To migrate automatically at startup, set `KAIRO_EMBEDDING_PACK_REBUILD=auto` (or `on_start` to force rebuild from legacy).

## Build the vector index

When ANN is enabled and you want to avoid rebuild at startup, precompute the vector index once:


```bash
KAIRO_VECTOR_INDEX=hnsw \
KAIRO_VECTOR_INDEX_REBUILD=manual \
kairo-build-vector-index
```

Notes:

- For large repos, consider sharding: `KAIRO_VECTOR_INDEX_SHARDS=auto` (or a number like `4`).
- Default `KAIRO_VECTOR_INDEX=auto` falls back to brute-force if no index exists.
- The index is stored under `.kairo/vector-index/<provider>/<model>/`.

## Troubleshooting

- If lexical search is missing or slow, confirm the native core is available:
  - `CAP_NATIVE_SEARCH_UNAVAILABLE` → build the native core (`npm run build:core-rs`), then retry.
  - Check `manage({ command: "status" })` → `nativeSearch.available`.
- If embeddings are not found:
  - verify `KAIRO_EMBEDDING_MODEL` matches your folder name
  - verify `KAIRO_MODEL_DIR` points at the directory that contains the model folder
- If a host has “random parse errors”:
  - keep stdout clean (`KAIRO_ALLOW_STDOUT_LOGS=false`, file logging enabled)

