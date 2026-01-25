# ADR-079 (Summary): Workflow UX & Style Reliability v2

## Intent

- Make the workflow clearer by summarizing “current state / next actions” in `status/doctor`.
- When `change(plan)` fails, provide coaching to immediately pivot to structured inputs.
- Strengthen StylePack with evidence-based metadata (references/config detections) and keep formatters opt-in.

## Progress

- Added `currentSession`, `artifactSummary`, and `recommendedActions` to `manage status/doctor` summaries.
- On `change(plan)` failures, include `schemaCoaching` (requiredFields/editsTemplate/helpUrl, etc.).
- Added `references`, `configDetections`, and `confidence` metadata to StylePack.

## Implementation Status

- [x] Phase A: status/doctor summaries + change(plan) coaching + StylePack v2 metadata
- [x] Phase B: artifacts/sessions UX alignment + style check integration (exclude `vibe` from default blockOn)
- [x] Phase C: formatter bridge + style drift surfaced in doctor

## Configuration Notes

- The formatter bridge is opt-in and controlled via `options.formatter` and `KAIRO_FORMATTER_MAX_FILES`.
- To keep undo/rollback consistent, formatting is skipped by default; enable with `KAIRO_FORMATTER_ALLOW_UNTRACKED=true` if needed.
