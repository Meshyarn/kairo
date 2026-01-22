# ADR-066: Guardrails Override & Audit Trail

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `docs/adr/ADR-065-change-execution-contract-atomic-apply-partial-opt-in-delete-policy.md`

## Summary

Guardrails relaxation is only allowed via the `override` object and must pass allowlist/TTL/scope validation. Override requests/denials/applications are recorded in an audit JSONL log and can be queried via `project_manage audit`.

## Decision

- Add `override` to `change`/`write`/`edit_apply` inputs
- Block with `OVERRIDE_*` errors when allowlist/TTL/scope validation fails
- Persist audit logs to `.kairo/data/audit/audit.jsonl`
- Include recent override summaries + policy settings in `doctor` output

## Implementation Notes

- Override validation/schema: `src/utils/GuardrailsOverride.ts`, `src/server/tools/ToolSpecRegistry.ts`
- Audit log persistence/querying: `src/utils/AuditLog.ts`, `src/handlers/ManageHandlers.ts`
- Override trace propagation: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`, `src/handlers/EditHandlers.ts`
- Guardrails bypass support in batch apply: `src/orchestration/pillars/change/BatchExecution.ts`

## Testing

- Change tests: `src/tests/handlers/EditHandlers.branches.test.ts`
