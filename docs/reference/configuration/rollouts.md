# Rollouts & experiments

These knobs are primarily for controlled rollout, canaries, and experimentation. If you want predictable production behavior, prefer sticking to presets and the default policy files.

## Native engine toggles (ADR-053-H)

| Variable | Purpose | Notes |
|---|---|---|
| `KAIRO_RUST_CORE_ENABLED` | Enable Rust core globally. | `on/off` (default: on). |
| `KAIRO_RUST_CHUNKING_ENABLED` | Enable Rust chunking. | `on/off` (default: on). |
| `KAIRO_RUST_DIFF_ENABLED` | Enable Rust diffing. | `on/off` (default: on). |
| `KAIRO_RUST_SYNTAX_ENABLED` | Enable Rust syntax validation. | `on/off` (default: on). |
| `KAIRO_RUST_VECTOR_ENABLED` | Enable Rust vector math. | `on/off` (default: on). |
| `KAIRO_RUST_SYMBOLIC_SOLVER_ENABLED` | Enable Rust symbolic solver capability. | `on/off` (default: on; only when Rust core enabled). |
| `KAIRO_WASM_CHUNKING_ENABLED` | Enable WASM chunking provider. | `on/off` (default: off). |
| `KAIRO_RUST_CHUNKING` | Legacy Rust chunking toggle. | Backward-compat; prefer `KAIRO_RUST_CHUNKING_ENABLED`. |
| `KAIRO_TOKENIZER_PATH` | Absolute path to `tokenizer.json`. | Optional; Kairo automatically discovers this in standard cache/model paths. |
| `KAIRO_DOC_CHUNK_PROFILE` | Default token chunk profile for indexing. | `fast/balanced/deep` (only used when outlineOptions don’t override). |

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

