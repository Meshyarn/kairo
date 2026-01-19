# ADR-066: Guardrails Override & Audit Trail

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `docs/adr/ADR-065-change-execution-contract-atomic-apply-partial-opt-in-delete-policy.md`

## Summary

guardrails 완화는 `override` 객체로만 허용하고 allowlist/TTL/scope 검증을 통과해야 한다. override 요청/거부/적용은 모두 audit JSONL로 기록되며 `project_manage audit`로 조회한다.

## Decision

- `change`/`write`/`edit_apply` 입력에 `override` 추가
- allowlist/TTL/scope 검증 실패 시 `OVERRIDE_*` 에러로 block
- audit log 저장: `.kairo/data/audit/audit.jsonl`
- `doctor` 출력에 최근 override 요약 + 정책 설정을 포함

## Implementation Notes

- override 검증/스키마: `src/utils/GuardrailsOverride.ts`, `src/server/tools/ToolSpecRegistry.ts`
- audit log 저장/조회: `src/utils/AuditLog.ts`, `src/handlers/ManageHandlers.ts`
- override trace 포함: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`, `src/handlers/EditHandlers.ts`
- batch apply에서도 guardrails bypass 반영: `src/orchestration/pillars/change/BatchExecution.ts`

## Testing

- 변경 테스트: `src/tests/handlers/EditHandlers.branches.test.ts`
