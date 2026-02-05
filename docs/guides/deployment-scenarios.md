# Deployment Scenarios

Practical configuration profiles for common environments. Pick a scenario and then customize via `.kairo/config/*` and a small set of env vars.

**Audience:** Anyone deploying Kairo to production or a team environment.

---

## Quick Scenario Selector

| Your situation | See section | Time to deploy |
|---|---:|---:|
| Solo dev, local machine | Development | 5 min |
| Team with shared CI/CD | Team CI/CD | 15 min |
| Agent / AI system | Production Agent | 20 min |
| Restricted / air-gapped | Air-gapped | 10 min |
| Low-resource environment | Resource constrained | 10 min |
| Multi-tenant | Multi-tenant | 30 min |

---

## Scenario 1: Development (Local Machine)

**Goals:** Fast startup, minimal setup, safe MCP defaults.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-lean
export KAIRO_EMBEDDING_PROVIDER=hash
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=15
export NODE_OPTIONS="--max-old-space-size=4096"
```

Recommended steps:

1) Wire your MCP host to run Kairo (stdio).
2) (Optional) `manage({ command: "init", mode: "apply" })` to write `.kairo/config/*`.
3) `manage({ command: "reindex" })` once, then iterate.

---

## Scenario 2: Team CI/CD (Shared Container / Build System)

**Goals:** Consistent behavior, persistent caches, reproducible indexing.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-balanced
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_MODEL=multilingual-e5-small
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_VECTOR_INDEX_REBUILD=manual
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=20
export NODE_OPTIONS="--max-old-space-size=6144"
```

Cache strategy:

- Persist the target project’s `.kairo/` directory between CI runs (artifact or persistent volume).
- Run `manage({ command: "reindex" })` only when inputs change (deps, source files, embedding settings).

Bootstrapping without an interactive host:

- Use any MCP client (SDK) to call `manage` commands against Kairo.
- This repo includes a reference client you can adapt:

```bash
# Example: build + reindex a real repo (writes `.kairo/` when storage mode is file)
npm run build
KAIRO_STORAGE_MODE=file node scripts/mock-mcp-client.mjs --root /path/to/project
```

---

## Scenario 3: Production Agent (High Throughput)

**Goals:** Deep analysis, predictable latency, strong observability.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-deep
export KAIRO_EMBEDDING_PROVIDER=local
export KAIRO_EMBEDDING_PACK_FORMAT=float32
export KAIRO_VECTOR_INDEX=hnsw
export KAIRO_VECTOR_INDEX_REBUILD=manual
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=25
export KAIRO_TOOL_SCHEMA_MODE=compat
export NODE_OPTIONS="--max-old-space-size=8192"
```

Operational checklist:

- Periodically collect `manage({ command: "status", detail: "full" })` output.
- Watch drift (`drift.workspaceDrift`) and repair with targeted reindex when possible.
- Keep stdout clean; route logs to file (`KAIRO_LOG_TO_FILE=true` + `KAIRO_LOG_DIR`/`KAIRO_LOG_FILE`).

---

## Scenario 4: Air-gapped / Restricted Environment

**Goals:** Zero external downloads at runtime, offline-first operation.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_LOG_TO_FILE=true
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=10
export NODE_OPTIONS="--max-old-space-size=2048"
```

Notes:

- Keep embeddings disabled unless you can bundle all required model assets locally.
- Verify your host does not leak stdout into the MCP stream (prefer file logs).

---

## Scenario 5: Resource Constrained (Edge / Low memory)

**Goals:** Minimal memory footprint, fast cold starts.

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-lean
export KAIRO_EMBEDDING_PROVIDER=disabled
export KAIRO_LOG_TO_FILE=false
export KAIRO_ALLOW_STDOUT_LOGS=false
export KAIRO_MAX_RESULTS=5
export NODE_OPTIONS="--max-old-space-size=1024"
```

Tips:

- Prefer lexical-only workflows (`KAIRO_EMBEDDING_PROVIDER=disabled`).
- Keep responses small (lower `KAIRO_MAX_RESULTS`, use `limits.maxTokens` / `limits.maxChars` in calls).

---

## Scenario 6: Multi-tenant (Advanced)

**Goals:** Isolate runtime data per tenant, keep logs separate, avoid cross-tenant drift.

Per tenant:

```bash
export KAIRO_MODE=mcp
export KAIRO_PRESET=mcp-balanced
export KAIRO_ROOT_PATH=/data/tenants/${TENANT_ID}/codebase
export KAIRO_DIR=/data/tenants/${TENANT_ID}/.kairo
export KAIRO_LOG_TO_FILE=true
export KAIRO_LOG_DIR=/data/tenants/${TENANT_ID}/logs/kairo
export KAIRO_TOOL_SCHEMA_MODE=compat
export KAIRO_MAX_RESULTS=20
export NODE_OPTIONS="--max-old-space-size=2048"
```

Resource limits:

- Use container / OS limits for memory and CPU.
- Use MCP host per-request timeouts; server-side `timeboxMs` can be set in `.kairo/config/mcp.json` as a best-effort cap.

---

## Comparison Table (high level)

| Aspect | Dev | Team CI/CD | Prod Agent | Air-gapped | Resource-limited |
|---|---|---|---|---|---|
| Preset | `mcp-lean` | `mcp-balanced` | `mcp-deep` | `mcp-lean` | `mcp-lean` |
| Embeddings | `hash` | `local` | `local` | `disabled` | `disabled` |
| Cache persistence | Optional | Yes | Yes | Optional | No |
| Best for | Iteration | Consistency | Scale | Compliance | Efficiency |

---

## Next Steps

- [Project config files](/reference/configuration/project-files)
- [Logging & telemetry](/reference/configuration/logging-and-telemetry)
- [Performance & reliability](/concepts/performance-and-reliability)

