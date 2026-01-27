# Safe Writes: plan → apply, drift, tokens

Kairo treats edits as a **two-phase contract** so agent frameworks can keep “writes” trustworthy.

## The handshake

In MCP mode (`KAIRO_MODE=mcp`), change/write flows are typically gated:

1. **Plan**: produce a draft (`draftId`) and (in MCP mode) a one-time `applyToken`.
2. **Apply**: perform the edit using `draftId + applyToken`.
3. **Verify**: confirm the result (sometimes embedded in apply).

This prevents accidental writes and makes host-level permissioning easier.

## Drift-aware safety

**Drift** occurs when a file changes on disk (by a human, formatter, CI, or another agent) **after** a plan is made but **before** it is applied.

### Timeline example

```
1. Plan phase
   ├─ Kairo snapshots "src/auth.ts" (hash: abc123)
   └─ Returns draftId + applyToken (encoding hash: abc123)

2. Time gap (seconds to hours)
   ├─ User/formatter edits "src/auth.ts" manually
   ├─ CI runs prettier and modifies hash to xyz789
   └─ File now contains different content

3. Apply phase
   ├─ Host calls apply with applyToken (expects hash: abc123)
   ├─ Kairo checks current file hash: xyz789
   └─ MISMATCH! → apply is rejected
```

### Why drift detection matters

Without drift detection:
- Kairo would **blindly apply edits** over changed content → corrupted file
- Merge conflicts would be silent → hidden bugs
- Multiple agents editing simultaneously → data loss

With drift detection:
- Apply fails **loudly** with clear reason
- Host must resolve (re-plan or manual fix)
- Safe recovery ladder: re-read → reindex → narrow scope

Kairo protects against this:

1. **Snapshot**: When planning, Kairo snapshots the file state (hash/version).
2. **Token**: The `applyToken` encodes this expected state.
3. **Block**: If the file drifts, the token is rejected.

Common block reasons:

- apply token is missing/expired/used,
- target mismatch (host/agent tries to apply a draft to a different file),
- drift detected vs the plan snapshot,
- policy/guardrail violations.


## Framework do’s and don’ts

Do:

- Prefer executing `guidance.nextCalls` verbatim.
- Serialize apply operations (tokens are one-time).
- Log `draftId/applyToken` in host telemetry (redact tokens if needed).

Don’t:

- Re-send `edits`/targets during apply unless necessary.
- Override `targetPath` on apply for a write draft (mismatches should be blocked).

For the precise contract:

- [Tool Reference](/agent/TOOL_REFERENCE)
- [ADR-086](/adr/ADR-086-task-compact-change-write-verify)

