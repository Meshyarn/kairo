# ADR-089: Raw Content Sources for `change`/`write` (No Quote/Escape Breakage)

**Status:** Implemented  
**Date:** 2026-01-25  
**Related:** `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`, `docs/adr/ADR-050-writers-flow.md`, `docs/adr/ADR-064-fileversion-handshake-read-apply.md`, `docs/adr/ADR-086-task-compact-change-write-verify.md`, `docs/guides/raw-content.md`

`write`/`change` are correctness tools: the exact bytes written to disk are the outcome.

However, the MCP/tool-call transport is JSON, and sending quote-heavy text (Vue/Svelte/Astro templates, JSON, regex literals, nested strings) as JSON strings repeatedly caused:

- tool-call JSON parse failures,
- accidental escape transformations (`\"`, double-escaping),
- downstream syntax errors and manual post-processing (`sed`, etc.).

ADR-089 introduces a standard **ContentSource** contract so callers can provide raw text via safer channels (`file`, `base64`, `artifact`) while keeping the tool schema discoverable and backward-compatible (ADR-058). The server resolves a source into a canonical string **exactly once**, and Writer’s Flow plan→apply uses draft snapshots to avoid TOCTOU.

## Decision

### 1) Introduce `ContentSource`

`ContentSource` is a tagged object used by both `write` and `change`:

```ts
type ContentSource =
  | { kind: "inline"; text: string }
  | { kind: "base64"; base64: string; charset?: "utf8" }
  | { kind: "file"; path: string }              // repo-root relative recommended
  | { kind: "artifact"; id: string };           // flow artifact id
```

### 2) Extend tool contracts

- `write`: add `contentSource?: ContentSource` (takes precedence over `content`).
- `change`: add `edits[].targetSource?: ContentSource` and `edits[].replacementSource?: ContentSource`
  (each takes precedence over the corresponding `targetString` / `replacementString`).

### 3) Resolve sources once (plan→apply safety)

- The server resolves `ContentSource` into canonical text at tool execution start.
- For Writer’s Flow, the resolved text is stored in the draft snapshot so apply does not re-read sources.
  This prevents plan/apply drift from external edits to the source file.

### 4) `file` sources: repo scope, ignore rules, size limits

For `ContentSource(kind="file")`:

- Paths are constrained to the allowed workspace/repo roots (multi-repo aware via `repoId`/`repoScope`).
- Ignore rules are applied (`.gitignore` + `.mcpignore` + Kairo internal ignores).
- Internal directories are blocked by default; **only** the temp directories are allowed:
  - `.kairo/tmp`, `.kairo/temp` (or `${KAIRO_DIR}/tmp`, `${KAIRO_DIR}/temp`)
- Maximum read size is capped (default 1MB), configurable via `KAIRO_CONTENT_SOURCE_MAX_BYTES`.

### 5) Compatibility & deprecation (Phase 2)

Legacy/stopgap fields remain functional but are deprecated:

- `write.contentBase64` (and `contentB64` legacy alias) maps to `contentSource(kind="base64")`.
- `change.edits[].targetStringBase64` / `targetBase64` map to `targetSource(kind="base64")`.
- `change.edits[].replacementStringBase64` / `replacementBase64` map to `replacementSource(kind="base64")`.

When these fields are used, deprecation warnings are emitted (via contract findings / guidance warnings).

## Implementation notes (this repo)

- ContentSource resolver (inline/base64/file/artifact) + repo/ignore enforcement:
  - `src/utils/ContentSourceResolver.ts`
- Tool contract surface + schema:
  - `src/server/tools/ToolSpecRegistry.ts`
- Compat mapping + deprecation findings:
  - `src/server/tools/ToolArgs.ts`
- `write` normalization + runtime resolution:
  - `src/orchestration/pillars/write/WriteInputNormalizer.ts`
  - `src/orchestration/pillars/WritePillar.ts`
- `change` runtime resolution (and source stripping to prevent re-read/TOCTOU):
  - `src/orchestration/pillars/change/ChangePillar.ts`
- Temp directory helpers + TTL pruning:
  - `src/utils/PathManager.ts`
  - `src/indexing/StorageMaintenanceService.ts`

Docs:

- Guide: `docs/guides/raw-content.md` (+ `/ko/` equivalent)
- Tool reference: `docs/agent/TOOL_REFERENCE.md` (+ `/ko/` equivalent)

## Consequences

- Hosts/SDKs can avoid quote/escape breakage by writing raw payloads to `.kairo/tmp` and passing `contentSource(kind="file")`.
- `write`/`change` inputs are safer and more debuggable (explicit source kinds + structured errors).
- Compatibility remains intact while guiding clients toward the `ContentSource` standard.
