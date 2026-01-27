# ADR-002: Smart Engine Refactoring & Tool Separation (Historical)

**Status:** Proposed

## Context

The initial `kairo` prototype proved local file operations, but the codebase needed clearer
separation between:

- The MCP/server interface layer (request/response wiring)
- The “smart” core logic (search, context extraction, safe editing)

## Decision

Refactor into a controller + engine layout and expose purpose-built tools instead of a single
monolithic “do everything” endpoint.

- **Tools:** `list_directory`, `search_files`, `read_file`, `read_fragment`, `write_file`, `edit_file`
- **Engine modules:** filesystem safety/ignore rules, search + ranking, interval merging for reads,
  and conflict-safe batch edits

## Consequences

- Enables independent evolution/testing of search/context/edit logic.
- Makes tool behavior more predictable for agents (clear contracts per tool).

