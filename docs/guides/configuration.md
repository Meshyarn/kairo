# Configuration (Minimal)

Kairo is configured via environment variables. Most users only need a few.

## Common env vars

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_ROOT_PATH` | Project root to analyze. | Preferred over cwd; equivalent to `--root` CLI arg. |
| `KAIRO_ROOT` | Project root to analyze. | Alias for `KAIRO_ROOT_PATH`. |
| `KAIRO_DIR` | Data directory. | Defaults to `.kairo` (contains index/cache/history). |
| `KAIRO_MAX_RESULTS` | Search result cap. | Lower for token-efficiency; raise for recall. |
| `KAIRO_LOG_LEVEL` | Structured logging level. | `debug|info|warn|error`. |
| `KAIRO_LOG_TO_FILE` | Persist logs under `.kairo`. | Prefer this in MCP hosts (keeps stdout clean). |
| `KAIRO_ALLOW_STDOUT_LOGS` | Allow stdout logs. | Avoid in MCP hosts; stdout is reserved for MCP frames. |
| `KAIRO_STORAGE_MODE` | Storage backend. | `file` (default) or `memory` (non-persistent). |

Timeouts are primarily controlled by your MCP host (per-request timeout). Some operations also accept per-call timeouts via `limits.timeoutMs` (see `docs/agent/TOOL_REFERENCE.md`).

## Storage maintenance (ADR-059)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_STORAGE_PRUNE_INTERVAL_MS` | Background prune interval (ms). | `0`/unset disables background prune. |
| `KAIRO_STORAGE_PRUNE_ON_START` | Run prune once on startup. | `true` to enable. |
| `KAIRO_STORAGE_PRUNE_FLOW_ARTIFACTS` | Include flow artifacts in prune. | `true` to enable. |
| `KAIRO_STORAGE_PRUNE_COMPACT` | Run compact rewrite after prune. | `true` to enable. |
| `KAIRO_EVIDENCE_PACK_MAX_COUNT` | Evidence pack max count cap. | Default ~300. |
| `KAIRO_EVIDENCE_PACK_MAX_BYTES` | Evidence pack byte cap. | Default 100MB. |
| `KAIRO_EVIDENCE_PACK_STALE_CHECK_MAX_ITEMS` | Evidence pack stale sampling limit. | Default 24 items. |
| `KAIRO_CHUNK_SUMMARY_MAX_CHUNKS` | Chunk summary max chunk count. | Default 20k. |
| `KAIRO_CHUNK_SUMMARY_MAX_BYTES` | Chunk summary byte cap. | Default 100MB. |

## Project config files (OSS essentials)

These files live under `.kairo/` in the **target project root**.

### Multi-repo config (optional)

Create `.kairo/config/mcp-config.json`:

```json
{
  "version": "1.0",
  "repositories": {
    "main": {
      "path": ".",
      "name": "Main Repo",
      "type": "primary",
      "languages": ["typescript"],
      "allowCrossRepoEdits": false
    }
  },
  "defaultRepo": "main"
}
```

- Legacy location (if you already have it): `.mcp-config.json` in the project root.
- Migration helper: `npm run migrate:mcp-config`
- `allowCrossRepoEdits` must be explicitly set to `true` per repo to allow cross-repo edits (tool input must also set `allowCrossRepoEdits: true`).

### Language mappings (optional)

Create `.kairo/config/languages.json` to extend or override built-ins:

```json
{
  "version": 1,
  "mappings": {
    ".py": { "languageId": "python", "parserBackend": "web-tree-sitter", "fallbackStrategy": "regex" }
  }
}
```

### Config bootstrap (manage init/doctor)

You can generate a starter config skeleton with the `manage` tool:

- `manage({ command: "init", mode: "plan" })` → returns a plan (no files written)
- `manage({ command: "init", mode: "apply" })` → writes `.kairo/config/*` (and minimal `.mcp-config.json`)
- `manage({ command: "doctor" })` → diagnoses missing/misplaced settings and suggests fixes

Common `doctor` scopes:

- `manage({ command: "doctor", scope: "languages" })` → extension/languageId mapping issues
- `manage({ command: "doctor", scope: "parity" })` → query packs + WASM grammar availability (policy-aware)
- `manage({ command: "doctor", scope: "contracts" })` → `.kairo/contracts` health (missing/invalid/stale)

By default, `init` targets Kairo config files only. Pass `targets: ["vscode"]` to get a suggested `.vscode/mcp.json` patch.

## Documents / parsers

| Variable | Purpose |
|---|---|
| `KAIRO_WASM_DIR` | Where tree-sitter WASM assets are resolved (including Markdown/SQL WASM). |

### Document extraction limits

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_DOC_MAX_FILE_BYTES` | Max bytes before sampling text files. | Triggers head/tail sampling. |
| `KAIRO_DOC_SAMPLE_HEAD_BYTES` | Bytes kept from the start when sampling. | Applies to text-based docs. |
| `KAIRO_DOC_SAMPLE_TAIL_BYTES` | Bytes kept from the end when sampling. | Applies to text-based docs. |
| `KAIRO_PDF_MAX_PAGES` | Max pages extracted from PDF. | Caps extraction for large PDFs. |
| `KAIRO_PDF_MAX_CHARS` | Max total extracted chars for PDF. | Triggers `pdf_char_cap`. |
| `KAIRO_PDF_MIN_CHARS` | Min chars before `pdf_needs_ocr`. | Signals OCR needs. |
| `KAIRO_PDF_MIN_CHARS_PER_PAGE` | Min chars per page before `pdf_low_text_density`. | Signals low text density. |
| `KAIRO_XLSX_MAX_SHEETS` | Max sheets extracted from XLSX. | Caps extraction. |
| `KAIRO_XLSX_MAX_ROWS` | Max rows per sheet. | Caps extraction. |
| `KAIRO_XLSX_MAX_COLS` | Max columns per sheet. | Caps extraction. |

## Token budgets (ADR-056)

Kairo can cap responses using `limits.maxTokens` (token-first) in addition to `limits.maxChars` (character caps).

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_DEFAULT_MAX_TOKENS` | Default token budget (server-side). | Used when a pillar does not specify its own default and the call does not pass `limits.maxTokens`. |
| `KAIRO_EXPLORE_MAX_TOKENS` | Default token budget for `explore`. | Overrides `KAIRO_DEFAULT_MAX_TOKENS`. |
| `KAIRO_UNDERSTAND_MAX_TOKENS` | Default token budget for `understand`. | Overrides `KAIRO_DEFAULT_MAX_TOKENS`. |
| `KAIRO_READ_MAX_TOKENS` | Default token budget for `read`. | Overrides `KAIRO_DEFAULT_MAX_TOKENS`. |
| `KAIRO_TOKEN_ESTIMATOR` | Token estimator mode. | `whitespace` (default) or `chars`. |

## Native engine toggles (ADR-053-H)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_RUST_CORE_ENABLED` | Enable Rust core globally. | `on/off` (default: on). |
| `KAIRO_RUST_CHUNKING_ENABLED` | Enable Rust chunking. | `on/off` (default: on). |
| `KAIRO_RUST_DIFF_ENABLED` | Enable Rust diffing. | `on/off` (default: on). |
| `KAIRO_RUST_SYNTAX_ENABLED` | Enable Rust syntax validation. | `on/off` (default: on). |
| `KAIRO_RUST_VECTOR_ENABLED` | Enable Rust vector math. | `on/off` (default: on). |
| `KAIRO_WASM_CHUNKING_ENABLED` | Enable WASM chunking provider. | `on/off` (default: off). |
| `KAIRO_RUST_CHUNKING` | Legacy Rust chunking toggle. | Backward-compat; prefer `KAIRO_RUST_CHUNKING_ENABLED`. |
| `KAIRO_TOKENIZER_PATH` | Absolute path to `tokenizer.json`. | Optional; Kairo automatically discovers this in standard cache/model paths. |
| `KAIRO_DOC_CHUNK_PROFILE` | Default token chunk profile for indexing. | `fast/balanced/deep` (only used when outlineOptions don’t override). |


## Skeleton (large files)

| Variable | Purpose |
|---|---|
| `KAIRO_SKELETON_AUTO_MINIMAL_LINES` | Auto-switch to `detailLevel=minimal` when line count exceeds threshold (0 disables). |

## Embeddings (optional)

| Variable | Purpose |
|---|---|
| `KAIRO_EMBEDDING_PROVIDER` | Select embedding backend (`local`, `remote`, `hash`, `disabled`). | `remote` is opt-in and enables downloads from HuggingFace. |
| `KAIRO_EMBEDDING_QUANTIZED` | Use quantized model (`true`/`false`). | Default: `true` (int8/q8). Set `false` for full precision (fp32/fp16). |
| `KAIRO_EMBEDDING_MODEL` | Bundled/local model identifier (default: `multilingual-e5-small`). |
| `KAIRO_MODEL_DIR` | Bundled model directory override (no remote downloads). |
| `KAIRO_MODEL_CACHE_DIR` | Local model cache directory override. |
| `KAIRO_EMBEDDING_E5_PREFIX` | Enable E5 `query:`/`passage:` prefixing (default: true). |

The local model folder name must match `KAIRO_EMBEDDING_MODEL`. See `docs/guides/getting-started.md` for download/prep steps.

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

## Trigram memory guard rails (P1)

| Variable | Purpose |
|---|---|
| `KAIRO_TRIGRAM_MAX_DOC_FREQ` | Drop trigrams above document frequency threshold (0-1). |
| `KAIRO_TRIGRAM_MAX_TERMS_PER_FILE` | Per-file trigram cap to limit memory. |

## Large repo performance

| Variable | Purpose |
|---|---|
| `KAIRO_INDEX_SCAN_BATCH_SIZE` | Yield to event loop after N entries during initial scan. |
| `KAIRO_INDEX_IGNORE_BATCH_SIZE` | Yield during `.gitignore` reindex sweeps. |
| `KAIRO_DOC_MAX_CANDIDATES` | Clamp document search candidate file count. |
| `KAIRO_DOC_MAX_CHUNK_CANDIDATES` | Clamp document search chunk candidates. |
| `KAIRO_DOC_MAX_VECTOR_CANDIDATES` | Clamp vector candidates in doc search. |
| `KAIRO_DOC_FALLBACK_MAX_FILES` | Cap fallback list when no doc candidates exist. |
| `KAIRO_DOC_LIST_FAST` | Skip sorting when listing document files (faster on huge repos). |

## Baseline indexing + symbol search

| Variable | Purpose |
|---|---|
| `KAIRO_BASELINE_ENABLED` | Enable baseline indexing on startup (`auto|on|off`). |
| `KAIRO_BASELINE_BLOCKING` | Force symbol search to wait for baseline (`true/false`). |
| `KAIRO_BASELINE_MAX_MS_PER_TICK` | Max baseline indexing time per tick (ms). |
| `KAIRO_BASELINE_MAX_FILES_PER_TICK` | Max files processed per baseline tick. |
| `KAIRO_SYMBOL_SECONDARY_INDEX` | Enable secondary symbol index (`auto|on|off`). |
| `KAIRO_SYMBOL_SECONDARY_INDEX_MAX_BYTES` | Cap secondary index file size (bytes). |
| `KAIRO_SYMBOL_SEARCH_MAX_CANDIDATES` | Max candidate refs evaluated in secondary index search. |
| `KAIRO_SYMBOL_FUZZY_SEARCH` | Enable fuzzy symbol search (`auto|on|off`). |
| `KAIRO_SYMBOL_FUZZY_MAX_FILES` | Max files for fuzzy search when `auto`. |

## Packaging (model bundle)

| Variable | Purpose |
|---|---|
| `KAIRO_MODEL_SOURCE` | Source directory used by `npm run bundle:models` (model root or parent). |
| `KAIRO_SKIP_MODEL_BUNDLE` | Skip bundling in `prepack` (`true` to skip). |
| `KAIRO_MODEL_BUNDLE_PROFILE` | Bundle profile (`minimal` default, `full` to include all assets). |

## Integrity audit (ADR-041)

| Variable | Purpose |
|---|---|
| `KAIRO_INTEGRITY_MODE` | Default integrity behavior. |
| `KAIRO_INTEGRITY_SCOPE` | Default scope (`docs` vs `project` vs `auto`). |
| `KAIRO_INTEGRITY_BLOCK_POLICY` | Whether high-severity findings block apply. |

## Modular rollout (ADR-045)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_MODULAR_HANDLERS_ENABLED` | Toggle modular handler registry. | `true/false` overrides percent. |
| `KAIRO_UNIFIED_EXTRACTION_ENABLED` | Toggle unified extraction pipeline. | `true/false` overrides percent. |
| `KAIRO_PILLAR_DECOMPOSITION_ENABLED` | Toggle decomposed pillar modules. | `true/false` overrides percent. |
| `KAIRO_MODULAR_ROLLOUT_PERCENT` | Percentage rollout for the modular flags. | `0-100`; uses rollout user hashing. |
| `KAIRO_ROLLOUT_USER` | Default user ID for rollout hashing. | Use if the host does not pass a user ID. |

## Adaptive flow rollout (ADR-075)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_ROLLOUT_MODE` | Rollout preset (`legacy|shadow|canary|beta|full`). | Primary preset switch. |
| `KAIRO_ROLLOUT_PHASE` | Alias for `KAIRO_ROLLOUT_MODE`. | Kept for backward compatibility. |
| `KAIRO_ROLLOUT_CANARY_USERS` | Canary allowlist. | Comma-separated user IDs. |
| `KAIRO_ROLLOUT_BETA_PERCENT` | Beta rollout percent. | `0-100`. |
| `KAIRO_ROLLOUT_FORCE` | Force preset application. | Applies even with explicit env overrides. |
| `KAIRO_ADAPTIVE_FLOW_ENABLED` | Override Adaptive Flow flag. | `on|off|canary|beta|full` (optional payload). |
| `KAIRO_UCG_ENABLED` | Override UCG flag. | Same format as above. |
| `KAIRO_TOPOLOGY_SCANNER_ENABLED` | Override topology scanner flag. | Same format as above. |
| `KAIRO_DUAL_WRITE_VALIDATION` | Toggle dual-write validation. | Same format as above. |
| `KAIRO_TOPOLOGY_SUCCESS_MIN` | Alert threshold for topology success rate. | Default `0.95`. |
| `KAIRO_UCG_MEMORY_MAX_MB` | Alert threshold for UCG memory estimate. | Default `500`. |
| `KAIRO_L3_PROMOTION_RATIO_MAX` | Alert threshold for L3 promotion ratio. | Default `0.5`. |

## Writer's flow defaults (ADR-051)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_WRITERS_FLOW_DEFAULT_DRYRUN` | Default dry-run for writer flow when sessionId is present. | `on|off|beta|canary` |
| `KAIRO_WRITERS_FLOW_REVIEW_DEFAULTS` | Enable session-based reviewOptions defaults. | `on|off|beta|canary` |

## StylePack cache (ADR-051)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_STYLE_PACK_TTL_MS` | Cache TTL for StylePack reuse across sessions. | Default: `1800000` (30 min). |
| `KAIRO_STYLE_PACK_CACHE_SIZE` | Max cached StylePacks. | Default: `50`. |

## Full list (source of truth)

Search the codebase: `rg "process\\.env\\.KAIRO_" src`.
