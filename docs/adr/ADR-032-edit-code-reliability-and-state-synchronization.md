# ADR-032: Edit Reliability & State Synchronization (Historical)

**Status:** Proposed (2025-12-19)

## Context

Edit reliability problems clustered around:

- Agent context drifting from on-disk reality across consecutive edits (version mismatch).
- Ambiguous escape handling (`\\n` vs newline) creating unintended matches.
- Overly permissive normalization increasing “matched the wrong place” risk.
- Cache invalidation timing issues on rapid edit sequences.

## Decision

Make state and parsing behavior explicit:

- Add **file version/hash** metadata to reads and optional **expectedVersion/expectedHash** checks
  on edits (fail fast with a clear mismatch error).
- Replace implicit escape variants with an explicit **escapeMode** (`literal` vs `interpreted`).
- Use conservative normalization defaults; warn when risky normalization is requested.
- Return richer post-edit state (new hashes/versions, affected ranges) for follow-up steps.

## Consequences

Reduces hard-to-debug “why didn’t it match?” loops and makes multi-step editing more deterministic.

