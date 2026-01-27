# ADR-019: Toolset Consolidation (Historical)

**Status:** Accepted

## Context

Early `kairo` accumulated many specialized tools. While powerful, this increased:

- Prompt/schema size and token waste.
- Tool selection errors for agents.
- Workflow brittleness from long call chains.

## Decision

Introduce five intent-based tools that wrap existing engines:

- `read_code`, `search_project`, `analyze_relationship`, `edit_code`, `manage_project`

Keep older tools temporarily for migration, then remove them once clients adopt the facades.

## Consequences

Moves toward a compact “public tool surface” and sets the stage for later pillar consolidation.

