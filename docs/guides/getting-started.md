# Getting Started (Kairo)

Kairo is an MCP server that communicates over **stdio**. Your MCP host launches it and applies timeouts/permissions.

## Requirements

- Node.js (modern LTS recommended)
- `npm` (or compatible)


## Run from this repo

```bash
cd kairo
npm ci
npm run build
node dist/index.js --root /absolute/path/to/your/project
```

Runtime data (indexes/caches/logs) is stored under `.kairo/` in the target project root by default.

## Prepare the local embedding model (offline)

Kairo is offline-first by default. Runtime downloads are disabled unless you explicitly opt into `KAIRO_EMBEDDING_PROVIDER=remote`.
Prepare a local model before bundling or running in a closed environment.

Recommended source: `Xenova/multilingual-e5-small` (ONNX + tokenizer files compatible with `@xenova/transformers`).

```bash
# On a machine with internet access (example using Hugging Face CLI)
huggingface-cli download Xenova/multilingual-e5-small \
  --local-dir /tmp/models/multilingual-e5-small \
  --local-dir-use-symlinks false

# Alternative (git-lfs)
# git lfs clone https://huggingface.co/Xenova/multilingual-e5-small /tmp/models/multilingual-e5-small
```

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

- The folder name must match `KAIRO_EMBEDDING_MODEL` (default: `multilingual-e5-small`).
- If you use a different model, ensure it ships ONNX + tokenizer assets compatible with `@xenova/transformers`.

Offline baseline:
- **Baseline-A (core)**: runs without network even if embeddings fall back to hash/disabled.
- **Baseline-B (embeddings-ready)**: local model files are present so vector search works offline.

## Bundle the offline embedding model (packaging)

When creating a release artifact, bundle the local model into `dist/models`:

```bash
# Point to a local model folder (either the model root, or a parent containing it)
KAIRO_MODEL_SOURCE=/path/to/models \
KAIRO_EMBEDDING_MODEL=multilingual-e5-small \
npm run bundle:models
```

- By default, bundling uses the **minimal** profile (required tokenizer/config + one ONNX file).  
  Set `KAIRO_MODEL_BUNDLE_PROFILE=full` to include all ONNX variants.
- `npm pack` / `npm publish` runs the bundling automatically via `prepack`.
- Set `KAIRO_SKIP_MODEL_BUNDLE=true` to skip bundling (dev-only).
- If you override `KAIRO_MODEL_DIR`, keep it inside `dist/models` so it ships with the package.

## Build the vector index (P1 optional)

When ANN is enabled and you want to avoid rebuild at startup, generate the vector index once:

```bash
KAIRO_VECTOR_INDEX=hnsw \
KAIRO_VECTOR_INDEX_REBUILD=manual \
kairo-build-vector-index
```

- For large repos, consider sharding: `KAIRO_VECTOR_INDEX_SHARDS=auto` (or a number like `4`).
- Default `KAIRO_VECTOR_INDEX=auto` will fall back to brute-force if no index exists.
- The index is stored under `.kairo/vector-index/<provider>/<model>/`.

## Build the embeddings pack (P2 optional)

For large repos, you can migrate legacy embedding persistence (`.kairo/storage/embeddings.json`) into a binary pack:

```bash
# float32 (safe default)
KAIRO_EMBEDDING_PACK_FORMAT=float32 \
kairo-migrate-embeddings-pack

# or store both float32 + q8 (recommended for future scaling experiments)
KAIRO_EMBEDDING_PACK_FORMAT=both \
kairo-migrate-embeddings-pack
```

- Pass `--force` to overwrite an existing pack.
- Pack files are stored under `.kairo/storage/v1/embeddings/<provider>/<model>/`.
- For very large packs, set `KAIRO_EMBEDDING_PACK_INDEX=bin` to use the binary index.
- To migrate automatically at startup, set `KAIRO_EMBEDDING_PACK_REBUILD=auto` (or `on_start` to force rebuild from legacy).

## Use as an MCP server (example config)

Point your MCP host at the built entry (Claude CLI / Gemini CLI / Codex CLI all have a concept of “stdio MCP server”; the config shape differs per tool but these fields are the same):

```json
{
  "command": "node",
  "args": ["/absolute/path/to/kairo/dist/index.js", "--root", "/absolute/path/to/your/project"],
  "timeout": 300000,
  "env": {
    "NODE_OPTIONS": "--max-old-space-size=4096",
    "KAIRO_MAX_RESULTS": "25"
  }
}
```

If your MCP host runs the server from a different working directory, always set `--root` (or `KAIRO_ROOT_PATH` / `KAIRO_ROOT`).

## Permissions (recommended)

Prefer a read-first workflow:

- Enable `explore` / `understand` by default
- Enable `change` / `write` only when you intend to apply edits

Some MCP hosts support allow/deny lists for tool names and shell commands. If yours does, start with read-only and expand gradually.

## First calls

- `explore({ query: "entrypoint" })`
- `explore({ paths: ["README.md"], view: "preview" })`
- `understand({ goal: "Explain the project architecture" })`
- `change({ intent: "Update greeting", targetFiles: ["src/greeting.ts"], edits: [{ targetString: "\"hello\"", replacementString: "\"hi\"" }], options: { dryRun: true } })`

## Writer's Flow (sessions) quickstart

For the best review quality and iteration speed, use a session and build the core artifacts once:

1) `explore` (optional) with `research.sketch=true`
2) `understand` with `vibe.extract=true` and `analysis.clusters=true`
3) `write` / `change` in `dryRun` first, then apply

Example:

```ts
const exploreRes = await explore({ query: "auth flow", research: { sketch: true }, sessionId: "new" });
const sessionId = exploreRes.sessionId;

await understand({
  goal: "src/auth",
  sessionId,
  vibe: { extract: true, scope: "src/**/*.ts" },
  analysis: { clusters: true }
});

const plan = await change({
  intent: "Update greeting",
  targetFiles: ["src/greeting.ts"],
  edits: [{ targetString: "\"hello\"", replacementString: "\"hi\"" }],
  options: { dryRun: true },
  sessionId
});

// Inspect: plan.workflowMeta + plan.workflowWarnings (if present)
await change({ ...plan, options: { dryRun: false }, sessionId });
```

When sessions are used, `write`/`change` include `workflowMeta` and (if needed) `workflowWarnings` to make missing steps obvious.

See `README.md` for the public overview.

## Next

- Configuration: `docs/guides/configuration.md`
