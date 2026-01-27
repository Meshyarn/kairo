# ADR-019: Toolset Consolidation Strategy (Historical)

**Status:** Accepted

## Context

An API surface with 15+ granular tools created integration friction for LLM agents:

- Tool schemas consumed prompt budget.
- Overlapping tools caused choice paralysis and selection errors.
- Multi-step orchestration increased failure points.

## Decision

Consolidate into a small set of intent-based facade tools (routing complexity moves server-side):

- `read_code` (full/skeleton/fragment views)
- `search_project` (files/symbols/directories; cluster-aware)
- `analyze_relationship` (deps/impact/calls/data-flow)
- `edit_code` (atomic edits; batch as the default shape)
- `manage_project` (status/history/guidance)

## Consequences

Reduces schema/token overhead and improves agent reliability, at the cost of more complex internal
dispatch/migration support.

