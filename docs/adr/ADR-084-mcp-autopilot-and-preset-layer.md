# ADR-084: MCP Autopilot & Preset Layer (Promptless/Agent-Agnostic Adoption)

**Status:** Implemented (0.5.x)  
**Date:** 2026-01-20  
**Related:** `docs/adr/ADR-040-five-pillars-toolset.md`, `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`, `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`, `docs/adr/ADR-077-mixed-workflow-resilience.md`, `docs/adr/ADR-078-cost-stabilization-and-adaptive-lod.md`, `docs/adr/ADR-080-response-envelope-token-budget-explore-understand.md`

## Summary

To address Kairo becoming a “powerful but heavy MCP server” (option explosion, response explosion, host-specific apply UX discontinuity), we introduce an **in-server Autopilot + Preset layer**.

The goal is not “agents picking options smartly”, but making Kairo a **promptless, high-success-rate MCP server**.

## Decision (What changed)

### 1) Split the public surface into two tiers

- **Compact surface (recommended default):** expose only `task` + `manage` to reduce the `list_tools` token footprint.
- **Pillars surface (advanced/direct control):** keep `explore/understand/change/write/manage`.
- Switch: `KAIRO_PUBLIC_SURFACE=compact|pillars`

### 2) Add the router tool `task`

`task` is a **high-level entrypoint** where the server decides which pillar/options to use.

- `mode`: `auto|ask|analyze|plan_change|apply_change|write|verify`
- `budget`: `lean|balanced|deep`
- Default output is always **summary-first**, and large results are split into **artifacts**.
- Some modes may be gradually rolled out (e.g., `write`/`verify`).

### 3) Reduce “env sprawl” via Presets/Modes

- `KAIRO_MODE=mcp|dev|ci` (default: `mcp`)
- `KAIRO_PRESET=mcp-lean|mcp-balanced|mcp-deep` (default for `mcp`: `mcp-lean`)
- Use `.kairo/config/mcp.json` to pin preset/surface/handshake/timeboxes locally (instead of relying on env vars).

### 4) Turn sloppy input into success (canonicalization + compat)

Normalize common alias/type mistakes from hosts/agents when possible, and record all conversions in `contract.findings`.  
(`KAIRO_TOOL_SCHEMA_MODE=compat|strict` follows the ADR-058 contract.)

### 5) Extend “short response + artifact” across pillars

Extend ADR-080’s envelope-budget + artifact-splitting pattern to `change/write/manage` so default responses do not blow up conversation context.

### 6) Enforce the apply handshake (2-phase commit) in the server

To keep safety invariants consistent across host UX differences, the server enforces **plan → apply**.

- Issue `applyToken` only in the plan phase
- Block apply without `draftId + applyToken`
- Recommended default policy: TTL/one-time/session-bound/drift-bound

### 7) verify is not “execution”, but “safe validation + an execution plan”

The default path does not run arbitrary shell commands.  
Instead, it performs internal validations where possible (guardrails/semantic checks, etc.) and provides a recommended validation plan for the user to run.

### 8) Provide schemas on-demand

When advanced options are needed on the compact surface:

- `manage({ command: "schema", tool: "<tool>", detail: "summary" | "full" })`

`detail:"full"` returns the schema JSON as an artifact.

## Implementation notes (current repo)

- Tool filtering (compact vs pillars): `src/server/SmartContextServer.ts`
- `task` tool schema: `src/server/tools/ToolSpecRegistry.ts`
- `task` routing + envelope: `src/handlers/TaskHandlers.ts`
- Preset/Mode resolution: `src/orchestration/policy/McpModePresetRegistry.ts`
- Apply token enforcement: `src/orchestration/pillars/change/ChangePillar.ts`, `src/orchestration/pillars/WritePillar.ts`
- On-demand schema export: `src/handlers/ManageHandlers.ts`

## Testing / SLO gates

- Host compatibility smoke: `src/tests/integration/McpHostCompatibility.e2e.test.ts`
- Task SLO gate: `scripts/adr-084-task-slo-gate.mjs`
- Beta telemetry smoke: `scripts/adr-084-beta-log-smoke.mjs`
- Hardening smoke: `scripts/adr-084-hardening-smoke.mjs`
