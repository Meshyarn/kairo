# ADR-077 (Summary): Mixed-workflow Resilience (Interop/Drift/Reconcile + Checkpoints + Integrity UX)

## Intent

- Treat mixed editing environments as a first-class path and surface drift as state.
- Reduce over-blocking and standardize recovery routes.
- Enable change tracking via minimal per-apply checkpoints (transaction ledger).

## Progress

- Surface workspace/repo-level drift summaries in `manage status/doctor` (mtime-based signals, best-effort).
- (Optional) allow manual serviceRoot scope definition via `.kairo/config/scopes.json`.
- When drift is detected, provide repair actions in order: `manage reindex(paths=...)` (when available) → `manage reindex`.
- Provide recent committed transaction checkpoint summaries in `manage history`.
- Record diff summaries (lines added/deleted/changed) on transaction commit.
- Include repair-ladder tags and degraded severity in standard responses.
- Add a mixed-workflow recovery playbook to the guides.

## Implementation Status

- [x] Phase A: drift state model + status/doctor surfacing + checkpoint summaries
- [x] Phase B: reconcile ladder + expanded severity model
- [x] Phase C: mixed-workflow playbook/guides

## Deferred (additional implementation)

- [x] drift signal expansion (hash/index revision/untracked, etc.)
- [x] serviceRoot discovery (manifest-based) + improved scope confidence
- [x] patchRef/patch blob store + `manage export` integration
- [x] external-edit scenario integration + E2E regression tests
