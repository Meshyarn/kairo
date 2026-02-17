# Project config files

These files live under `.kairo/` in the **target project root**.

## MCP mode config (optional)

Create `.kairo/config/mcp.json` to avoid host env sprawl and keep MCP defaults project-local:

```json
{
  "version": 1,
  "mode": "mcp",
  "preset": "mcp-balanced",
  "publicSurface": "compact",
  "applyHandshake": {
    "required": true,
    "tokenTtlMs": 1800000,
    "oneTime": true,
    "invalidateOnDrift": true
  },
  "autopilot": {
    "autoModeNeverApplies": true,
    "defaultOutputFormat": "summary",
    "maxAutoRepairAttempts": 1,
    "allowAutoReindex": false
  },
  "budgets": {
    "profile": "lean",
    "envelopeMaxTokens": { "explore": 4000, "understand": 5000, "change": 4000, "write": 4000, "manage": 6000 }
  },
  "timeboxMs": { "total": 15000, "perStep": 3000 }
}
```

- This file controls **mode/preset/surface** and router/autopilot defaults (see [ADR-084](/adr/ADR-084-mcp-autopilot-and-preset-layer)).
- `budgets`/`timeboxMs` are best-effort server-side caps to keep responses small and avoid host timeouts.
- It is distinct from `.kairo/config/.mcp-config.json` (multi-repo registry; see below).
- In precedence order: tool call overrides → `.kairo/config/mcp.json` → env vars → built-in preset defaults.

## Multi-repo config (optional)

Create `.kairo/config/.mcp-config.json`:

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

- Legacy locations (if you already have them): `.kairo/config/mcp-config.json` or `.mcp-config.json` in the project root.
- Migration helper: `npm run migrate:mcp-config`
- `allowCrossRepoEdits` must be explicitly set to `true` per repo to allow cross-repo edits (tool input must also set `allowCrossRepoEdits: true`).

## Language mappings (optional)

Create `.kairo/config/languages.json` to extend or override built-ins:

```json
{
  "version": 1,
  "mappings": {
    ".py": { "languageId": "python", "parserBackend": "web-tree-sitter", "fallbackStrategy": "regex" }
  }
}
```

## GraphRAG policy (optional)

Create `.kairo/config/graphrag.json` to tune GraphRAG defaults and seed policy:

```json
{
  "version": 1,
  "enabled": false,
  "seedPolicy": {
    "default": "lexical_default",
    "policies": {
      "path_first": { "weights": { "path": 1.0, "lexical": 0.6, "semantic": 0.2 } },
      "symbol_semantic": { "weights": { "semantic": 1.0, "lexical": 0.5, "path": 0.2 } },
      "lexical_default": { "weights": { "lexical": 1.0, "semantic": 0.3, "path": 0.3 } }
    }
  },
  "tuning": { "primaryGoal": "followup_calls", "secondaryGoal": "token_usage" },
  "crossBoundary": {
    "allowlist": ["ffi_napi", "idl_proto", "http_openapi", "db_sql_schema"],
    "caps": { "maxDepth": 1, "maxFiles": 8, "maxSymbols": 20, "maxTokens": 800 },
    "autoScale": true
  }
}
```

- `KAIRO_GRAPHRAG_ENABLED=true` forces GraphRAG on (overrides config).
- The config path is resolved under `KAIRO_DIR` (default: `.kairo/config/graphrag.json`), with a legacy fallback `KAIRO_DIR/graphrag.json`.
- Cross-repo cluster expansion follows the same safety model as edits: repo config must allow it (`allowCrossRepoEdits: true`) and the tool call must also pass `allowCrossRepoEdits: true`.

## Symbolic guards policy (optional)

Create `.kairo/config/symbolic-guards.json` to enable portable semantic checks (ADR-083):

```json
{
  "version": 1,
  "enabled": false,
  "mode": "warn",
  "timeoutMs": 1200,
  "maxDiagnostics": 12,
  "maxPaths": 64,
  "maxConstraints": 400,
  "rules": {
    "index_bounds": { "enabled": true, "severity": "high" },
    "division_by_zero": { "enabled": true, "severity": "high" },
    "null_deref_without_guard": { "enabled": true, "severity": "warn" }
  },
  "contractGuard": {
    "mode": "spec_only",
    "consumerScan": { "enabled": false, "maxFiles": 200 }
  },
  "solver": { "enabled": false, "providerOrder": ["rust"], "timeSliceMs": 200 }
}
```

- The config path is resolved under `KAIRO_DIR` (default: `.kairo/config/symbolic-guards.json`), with a legacy fallback `KAIRO_DIR/symbolic-guards.json`.
- Env overrides:
  - `KAIRO_SYMBOLIC_GUARDS_ENABLED=true|false`
  - `KAIRO_SYMBOLIC_GUARDS_MODE=off|warn|block_high|strict`
  - `KAIRO_SYMBOLIC_GUARDS_TIMEOUT_MS`, `KAIRO_SYMBOLIC_GUARDS_MAX_DIAGNOSTICS`, `KAIRO_SYMBOLIC_GUARDS_MAX_PATHS`, `KAIRO_SYMBOLIC_GUARDS_MAX_CONSTRAINTS`
- Solver is attempted only when `mode=strict` + `solver.enabled=true`, and requires Rust capability (`KAIRO_RUST_CORE_ENABLED` + `KAIRO_RUST_SYMBOLIC_SOLVER_ENABLED`).

## Config bootstrap (manage init/doctor)

You can generate a starter config skeleton with the `manage` tool:

- `manage({ command: "init", mode: "plan" })` → returns a plan (no files written)
- `manage({ command: "init", mode: "apply" })` → writes `.kairo/config/*` (including `.kairo/config/mcp.json` and `.kairo/config/.mcp-config.json`)
- `manage({ command: "doctor" })` → diagnoses missing/misplaced settings and suggests fixes

Common `doctor` scopes:

- `manage({ command: "doctor", scope: "languages" })` → extension/languageId mapping issues
- `manage({ command: "doctor", scope: "parity" })` → query packs + WASM grammar availability (policy-aware)
- `manage({ command: "doctor", scope: "contracts" })` → `.kairo/contracts` health (missing/invalid/stale)

By default, `init` targets Kairo config files only. Pass `targets: ["vscode"]` to get a suggested `.vscode/mcp.json` patch.

