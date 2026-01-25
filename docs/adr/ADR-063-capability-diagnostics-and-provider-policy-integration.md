# ADR-063: Capability Diagnostics & Provider Policy Integration

**Status:** Implemented  
**Date:** 2026-01-13  
**Related:** `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`

## Summary

Standardize a “diagnostic snapshot” so operators can quickly inspect capability/provider status and unavailability reasons (e.g., Rust core load failure, missing tokenizers) via `manage`/`doctor`.

## Decision

- Include a capability diagnostics snapshot in `manage status`.
- `manage doctor` provides capability diagnostics and hints for host/parity/capabilities scopes.
- Providers may implement an optional `diagnose()` to explain why they are unavailable.
- Promote tokenizer discovery to a shared utility so Rust chunking and doctor use the same decisions.

## Implementation Notes

- diagnostics snapshot: `src/orchestration/capabilities/EngineManager.ts`
- metrics tier tagging: `src/orchestration/capabilities/EngineManager.ts` (`capability.select.*`, `capability.fallback.*`)
- shared tokenizer utility: `src/orchestration/capabilities/TokenizerDiagnostics.ts`
- rust chunking diagnostics integration: `src/orchestration/capabilities/providers/RustChunkingProvider.ts`
- manage schema/output extensions: `src/server/tools/ToolSpecRegistry.ts`, `src/handlers/ManageHandlers.ts`
- doctor scope extensions (including capabilities scope): `src/config/ConfigBootstrapper.ts`

## Testing

- capability registry diagnostics: `src/tests/orchestration/DefaultEngineRegistry.test.ts`
- tokenizer diagnostics: `src/tests/orchestration/TokenizerDiagnostics.test.ts`
- manage status output: `src/tests/handlers/ManageHandlers.more.test.ts`
