# ADR-058: Tool Schema Contract & Compatibility Layer

**Status:** Implemented  
**Date:** 2026-01-12  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`

Unify tool input contracts via the ToolSpec Registry, and standardize alias/unknown-field handling and validation in compat/strict modes.

## Decision (v1 Contract)

- The ListTools schema has a single source of truth: the ToolSpec Registry.
- All calls go through a `normalize → validate → execute` pipeline.
- Alias/unknown/coercion issues emit standardized warnings under `contract.findings`.
- In strict mode (`KAIRO_TOOL_SCHEMA_MODE=strict`), unknown fields are rejected.

## Implementation Notes

- ToolSpec Registry: `src/server/tools/ToolSpecRegistry.ts`
- Normalize/validate: `src/server/tools/ToolArgs.ts`
- Server entrypoint wiring: `src/server/SmartContextServer.ts`

## Implementation Status (as of current code)

 - [x] Phase A: ToolSpec Registry + schema coverage for `limits.maxTokens` (explore/understand)
 - [x] Phase B: compat aliases (`file_read.raw → full`, `limits.max_tokens → limits.maxTokens`) + standardized `contract.findings` warnings
 - [x] Phase C: regression tests for schema/alias/strict mode
- [x] Internal tool schema drift hardening: reflect the real supported args in schemas (e.g., `file_search`/`file_scout` support `keywords/basePath/excludeGlobs/wordBoundary/...`) to avoid compat drops.

## Testing

- Schema fields/alias/strict-mode tests: `src/tests/tool_schema_contract.test.ts`
