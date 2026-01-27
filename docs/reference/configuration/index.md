# Configuration

Kairo is configured primarily through environment variables and a small set of project config files under `.kairo/`.

If you only set five things, start with:

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact`
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`

## Split reference (recommended)

The full env var list is large. Use these split pages to find what you need faster:

- [Basics](/reference/configuration/basics)
- [Project config files](/reference/configuration/project-files)
- [Logging & telemetry](/reference/configuration/logging-and-telemetry)
- [Search & embeddings](/reference/configuration/search-and-embeddings)
- [Performance & indexing](/reference/configuration/performance)
- [Change/write & drift](/reference/configuration/change-write-and-drift)
- [Storage & pruning](/reference/configuration/storage)
- [Documents & parsers](/reference/configuration/documents-and-parsers)
- [Token budgets](/reference/configuration/budgets)
- [Rollouts & experiments](/reference/configuration/rollouts)
- [Advanced tuning](/reference/configuration/advanced)

## Full list (single page)

If you prefer to `grep` a single file, the complete environment variable reference is available here:

- [Configuration (all env vars)](/guides/configuration)
