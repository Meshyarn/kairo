# ADR-020: Final Toolset Consolidation Strategy (Historical)

**Status:** Accepted

## Context

To reduce agent prompt/schema overhead and workflow brittleness, the tool surface needed to be
compact and predictable.

## Decision

Finalize the intent-based toolset with more explicit interfaces and operational guarantees:

- `read_code` (views, metadata, truncation/limits)
- `search_project` (cluster-aware results; optional intent inference)
- `analyze_relationship` (mode + direction; auto target resolution)
- `edit_code` (batch shape; atomic apply/rollback; create/delete operations)
- `manage_project` (undo/redo/guidance/status)

## Consequences

This ADR is a precursor to later “pillar + compact tool surface” documentation: fewer tools, more
well-specified modes/options, and consistent failure handling.

