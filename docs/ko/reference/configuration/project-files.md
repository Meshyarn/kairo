# 프로젝트 설정 파일

이 파일들은 **대상 프로젝트 루트**의 `.kairo/` 아래에 존재합니다.

## MCP 모드 설정(선택)

호스트 환경 변수 난립을 피하고 MCP 기본값을 프로젝트 로컬로 고정하려면 `.kairo/config/mcp.json`을 생성하세요:

```json
{
  "version": 1,
  "mode": "mcp",
  "preset": "mcp-lean",
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

- 이 파일은 **mode/preset/surface** 및 router/autopilot 기본값을 제어합니다([ADR-084](/adr/ADR-084-mcp-autopilot-and-preset-layer) 참고).
- `budgets`/`timeboxMs`는 응답을 작게 유지하고 호스트 타임아웃을 피하기 위한 best-effort 서버 측 상한입니다.
- `.kairo/config/.mcp-config.json`(멀티 레포 레지스트리; 아래 참고)과는 별개입니다.
- 우선순위: tool call overrides → `.kairo/config/mcp.json` → env vars → built-in preset defaults.

## 멀티 레포 설정(선택)

`.kairo/config/.mcp-config.json`을 생성하세요:

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

- 이미 존재한다면 레거시 위치: `.kairo/config/mcp-config.json` 또는 프로젝트 루트의 `.mcp-config.json`.
- 마이그레이션 헬퍼: `npm run migrate:mcp-config`
- cross-repo edits를 허용하려면 repo 단위로 `allowCrossRepoEdits: true`를 명시해야 합니다(툴 입력도 `allowCrossRepoEdits: true` 필요).

## 언어 매핑(선택)

기본 내장 매핑을 확장/오버라이드하려면 `.kairo/config/languages.json`을 생성하세요:

```json
{
  "version": 1,
  "mappings": {
    ".py": { "languageId": "python", "parserBackend": "web-tree-sitter", "fallbackStrategy": "regex" }
  }
}
```

## GraphRAG 정책(선택)

GraphRAG 기본값과 seed 정책을 조정하려면 `.kairo/config/graphrag.json`을 생성하세요:

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

- `KAIRO_GRAPHRAG_ENABLED=true`는 GraphRAG를 강제로 on 합니다(config를 오버라이드).
- config 경로는 `KAIRO_DIR` 아래에서 해석됩니다(기본: `.kairo/config/graphrag.json`), 레거시 폴백은 `KAIRO_DIR/graphrag.json`.
- cross-repo cluster 확장은 edits와 동일한 안전 모델을 따릅니다: repo config에서 허용(`allowCrossRepoEdits: true`) + tool call도 `allowCrossRepoEdits: true`.

## Symbolic guards 정책(선택)

이식 가능한 semantic checks(ADR-083)를 활성화하려면 `.kairo/config/symbolic-guards.json`을 생성하세요:

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

- config 경로는 `KAIRO_DIR` 아래에서 해석됩니다(기본: `.kairo/config/symbolic-guards.json`), 레거시 폴백은 `KAIRO_DIR/symbolic-guards.json`.
- Env overrides:
  - `KAIRO_SYMBOLIC_GUARDS_ENABLED=true|false`
  - `KAIRO_SYMBOLIC_GUARDS_MODE=off|warn|block_high|strict`
  - `KAIRO_SYMBOLIC_GUARDS_TIMEOUT_MS`, `KAIRO_SYMBOLIC_GUARDS_MAX_DIAGNOSTICS`, `KAIRO_SYMBOLIC_GUARDS_MAX_PATHS`, `KAIRO_SYMBOLIC_GUARDS_MAX_CONSTRAINTS`
- solver는 `mode=strict` + `solver.enabled=true`일 때만 시도되며, Rust capability가 필요합니다(`KAIRO_RUST_CORE_ENABLED` + `KAIRO_RUST_SYMBOLIC_SOLVER_ENABLED`).

## 설정 부트스트랩(manage init/doctor)

`manage`로 스타터 설정 스켈레톤을 생성할 수 있습니다:

- `manage({ command: "init", mode: "plan" })` → 계획 반환(파일은 쓰지 않음)
- `manage({ command: "init", mode: "apply" })` → `.kairo/config/*`를 작성( `.kairo/config/mcp.json` 및 `.kairo/config/.mcp-config.json` 포함)
- `manage({ command: "doctor" })` → 누락/오배치 설정을 진단하고 수정 제안을 제공

자주 쓰는 `doctor` scope:

- `manage({ command: "doctor", scope: "languages" })` → extension/languageId 매핑 문제
- `manage({ command: "doctor", scope: "parity" })` → query packs + WASM grammar availability (policy-aware)
- `manage({ command: "doctor", scope: "contracts" })` → `.kairo/contracts` 상태(누락/무효/스테일)

기본적으로 `init`은 Kairo 설정 파일만 타겟합니다. `targets: ["vscode"]`를 전달하면 `.vscode/mcp.json` 패치를 제안합니다.

