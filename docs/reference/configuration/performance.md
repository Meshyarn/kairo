# Performance & indexing

This page collects knobs that matter primarily for **large repos** and startup/indexing behavior.

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

