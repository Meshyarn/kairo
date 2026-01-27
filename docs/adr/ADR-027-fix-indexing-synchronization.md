# ADR-027: Fix Indexing Synchronization Issues (Historical)

**Status:** Proposed

## Context

Indexes and caches could become stale after changes to:

- Ignore rules (`.gitignore`)
- Module resolution config (`tsconfig.json` / `jsconfig.json`)
- File rename/delete operations (batched index updates)

This caused incorrect results from search/relationship tools until restart.

## Decision

Improve synchronization in stages:

- Watch critical config files and trigger targeted reactions:
  - `.gitignore` change → reload rules + purge newly ignored files + enqueue newly un-ignored files.
  - `tsconfig/jsconfig` change → reset module resolver caches and re-analyze unresolved edges.
- Add a manual escape hatch: `manage_project reindex` (clear DB + full rescan).
- Longer-term: central `ConfigurationManager`, priority indexing queue, and richer `status` reporting.

## Consequences

Reduces “why is the tool wrong?” moments by aligning tool outputs with the current filesystem and
configuration state.

