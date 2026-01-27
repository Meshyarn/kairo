# Storage & pruning

Kairo stores runtime state under `.kairo/` in the target project root by default.

## Core knobs

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_DIR` | Data directory. | Defaults to `.kairo` (contains index/cache/history). |
| `KAIRO_ALLOW_LEGACY_MCP_DIR` | Allow legacy `.mcp` paths for `KAIRO_DIR`. | Legacy `.mcp` paths are deprecated. Prefer `.kairo`. |
| `KAIRO_STORAGE_MODE` | Storage backend. | `file` (default) or `memory` (non-persistent). |

## Storage maintenance (ADR-059)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_STORAGE_PRUNE_INTERVAL_MS` | Background prune interval (ms). | `0`/unset disables background prune. |
| `KAIRO_STORAGE_PRUNE_ON_START` | Run prune once on startup. | `true` to enable. |
| `KAIRO_STORAGE_PRUNE_FLOW_ARTIFACTS` | Include flow artifacts in prune. | `true` to enable. |
| `KAIRO_STORAGE_PRUNE_TEMP_FILES` | Include temp files in prune (`.kairo/tmp`, `.kairo/temp`). | `true` to enable. |
| `KAIRO_STORAGE_PRUNE_COMPACT` | Run compact rewrite after prune. | `true` to enable. |
| `KAIRO_TASK_EVIDENCE_TTL_MS` | Task evidence pack TTL (ms). | Default `1800000` (30 minutes). |
| `KAIRO_EVIDENCE_PACK_MAX_COUNT` | Evidence pack max count cap. | Default ~300. |
| `KAIRO_EVIDENCE_PACK_MAX_BYTES` | Evidence pack byte cap. | Default 100MB. |
| `KAIRO_EVIDENCE_PACK_STALE_CHECK_MAX_ITEMS` | Evidence pack stale sampling limit. | Default 24 items. |
| `KAIRO_CHUNK_SUMMARY_MAX_CHUNKS` | Chunk summary max chunk count. | Default 20k. |
| `KAIRO_CHUNK_SUMMARY_MAX_BYTES` | Chunk summary byte cap. | Default 100MB. |
| `KAIRO_TEMP_FILE_TTL_MS` | Temp file TTL (ms). | Default `604800000` (7 days). Used when pruning `temp_files`. |
| `KAIRO_TEMP_FILE_MAX_COUNT` | Temp file max count cap. | Default `0` (no cap). Used when pruning `temp_files`. |

## Patch ledger disk guardrails

These guardrails protect on-disk patch history storage.

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_PATCH_STORAGE_WARN_FREE_PCT` | Patch ledger disk free warning threshold (%). | Default 8. |
| `KAIRO_PATCH_STORAGE_BLOCK_FREE_PCT` | Patch ledger disk free block threshold (%). | Default 3. |

For deeper detail:

- [Configuration (all env vars)](/guides/configuration)
