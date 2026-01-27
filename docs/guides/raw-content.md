# Raw Content Sources (write/change)

::: tip Stable (ADR-089)
Raw content sources are now supported for `write`/`change`.
Use `ContentSource` to avoid quote/escape breakage.
:::

When editing templates (Vue/Svelte/Astro), JSON, regex-heavy code, etc. it's easy to hit **quote / escape breakage**
when the content is transported as a JSON string.

ADR-089 introduces **ContentSource** so callers can provide content via a safer channel (file/base64/artifact),
while keeping the tool contract discoverable.

For the architecture decision and compatibility policy, see:

- [ADR-089: Raw content sources for change/write](/adr/ADR-089-raw-content-sources-for-change-write)

## ContentSource

`ContentSource` is a tagged object:

```json
{ "kind": "inline", "text": "..." }
```

Supported kinds:

- `inline` — same as sending a string, but explicit.
- `base64` — UTF-8 text encoded as base64.
- `file` — read text from a file path (repo-root relative).
- `artifact` — read text from a stored artifact id.

## `write`

Recommended: use `contentSource` for complex raw text.

- `contentSource` takes precedence over `content`.
- `contentBase64` exists as a legacy/stopgap path (deprecated; emits warnings).

Example (file):

```json
{
  "intent": "Update Vue template",
  "targetPath": "src/App.vue",
  "contentSource": { "kind": "file", "path": ".kairo/tmp/app.vue.txt" }
}
```

## `change` (structured edits)

For exact, unambiguous edits, use `targetSource` / `replacementSource` on each edit.

```json
{
  "intent": "Replace a template block",
  "targetFiles": ["src/App.vue"],
  "edits": [
    {
      "filePath": "src/App.vue",
      "targetSource": { "kind": "file", "path": ".kairo/tmp/target.txt" },
      "replacementSource": { "kind": "file", "path": ".kairo/tmp/replacement.txt" }
    }
  ]
}
```

## Migration (legacy fields)

Legacy base64 fields are still accepted but emit deprecation warnings. Prefer `contentSource`.

- `contentBase64` → `contentSource: { kind: "base64", base64: "..." }`
- `edits[].targetStringBase64` / `edits[].targetBase64` → `edits[].targetSource`
- `edits[].replacementStringBase64` / `edits[].replacementBase64` → `edits[].replacementSource`

Deprecation notices appear in tool contract findings and guidance warnings.

## Security & limits (file sources)

When using `contentSource.kind="file"`:

- Paths must stay within the workspace/repo roots (multi-repo aware via `repoId` / `repoScope`).
- Ignore rules apply (`.gitignore`, `.mcpignore`, and internal Kairo ignores).
- Internal directories are blocked by default; use the temp dir:
  - `.kairo/tmp` / `.kairo/temp` (or `${KAIRO_DIR}/tmp`, `${KAIRO_DIR}/temp`)
- Large files are rejected. The max size is controlled by `KAIRO_CONTENT_SOURCE_MAX_BYTES` (default: `1048576`).

## Client helper pattern

For complex templates, the safest flow is:

1) Write the raw text into `.kairo/tmp/<name>.txt`.
2) Plan: call `write` or `change` using `contentSource.kind="file"` (dry-run / `safety:"plan"`).
3) Apply: use the returned `draftId` (+ `applyToken` in MCP mode). Do not re-send `contentSource` during apply.
4) Optionally delete the temp file or rely on TTL cleanup (`KAIRO_TEMP_FILE_TTL_MS`).

## Multi-repo + ignore rules

- Paths are resolved relative to the **selected repo root** (`repoId` / `repoScope`).
- `file` sources must respect the project's ignore rules (e.g. `.gitignore`, `.mcpignore`, and Kairo internal ignores).

## Temp files (`.kairo/tmp`)

To avoid polluting git status and indexing/search, prefer generating temporary payloads under:

- `.kairo/tmp/` (or `KAIRO_DIR/tmp`)
