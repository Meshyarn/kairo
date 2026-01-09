# ADR-043: Adaptive Context Architecture (Adaptive Flow)

**Status:** Partially implemented (curated)  
**Intent:** Avoid the “parse everything or parse nothing” trap by promoting only the needed context to the needed depth.

## Summary

Adaptive Context Architecture introduces:

1) **LOD (Level of Detail)** for file understanding:

- **LOD 0**: metadata registry
- **LOD 1**: topology (imports/exports + top-level signatures)
- **LOD 2**: structure (skeletons)
- **LOD 3**: semantic (full resolution where available)

2) A **Unified Context Graph (UCG)** shared across pillars:

- Nodes: files (and symbols where applicable)
- Edges: imports/calls/dependencies
- Behavior: lazy promotion (only elevate files to higher LOD when required)

## Why

Without LOD + shared context:

- `explore` finds candidates but `understand` redoes expensive work
- token budgets are wasted by reading full files too early
- edits may trigger unnecessary analysis across unrelated areas

## Decision

- Shift orchestration from stateless “tool chain” to stateful, session-scoped context.
- Make “promotion” explicit and measurable (so we can control cost and degrade gracefully).

## Rejected alternatives

- “Parse everything up front”: rejected due to cost/latency on large repos and wasted work when the agent’s intent changes.
- Stateless reads only: rejected because it forces repeated expensive analysis across pillars.
- Always-return full files: rejected; progressive disclosure is the default for token safety.

## Revisit criteria

Revisit only if there is a reliable, low-cost way to keep full semantic models updated continuously across large repos without harming latency.

## Implementation notes (current repo)

Core primitives:

- `src/orchestration/context/UnifiedContextGraph.ts`
- `src/orchestration/context/FileWatcher.ts`
- `src/orchestration/OrchestrationContext.ts`

Feature gating:

- `src/config/FeatureFlags.ts` (e.g. `KAIRO_ADAPTIVE_FLOW_ENABLED`, `KAIRO_UCG_ENABLED`)

LOD-enabling components:

- `src/ast/*` (skeletons, tree-sitter backends, extraction)
- `src/engine/Search.ts` + orchestration pillars

## Notes for OSS users

If you don’t need Adaptive Flow immediately, the system still works; enabling it is a scaling/UX optimization rather than a hard requirement.
