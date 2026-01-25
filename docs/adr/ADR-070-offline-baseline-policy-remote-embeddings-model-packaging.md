# ADR-070: Offline Baseline Policy (remote embeddings, model packaging)

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `src/embeddings/*`, `scripts/bundle-models.mjs`, `src/handlers/ManageHandlers.ts`, `src/orchestration/capabilities/TokenizerDiagnostics.ts`

## Summary

Define a clear offline baseline and allow remote embeddings only via explicit opt-in. Default model bundling to the minimal profile and diagnose model availability using the same lookup rules at runtime and in doctor.

## Decision

- Diagnose the offline baseline as A (core) / B (embeddings-ready).
- Allow remote downloads only when `KAIRO_EMBEDDING_PROVIDER=remote`, and surface this in doctor/status.
- Default model bundling to the minimal profile and record a manifest.

## Implementation Notes

- embedding diagnostics + path resolution: `src/embeddings/EmbeddingDiagnostics.ts`, `src/embeddings/ModelPaths.ts`
- runtime model lookup alignment: `src/embeddings/TransformersEmbeddingProvider.ts`, `src/orchestration/capabilities/TokenizerDiagnostics.ts`
- doctor/status surfacing: `src/handlers/ManageHandlers.ts`
- doc search degraded reasons: `src/documents/search/DocumentSearchEngine.ts`
- bundle profiles/manifests: `scripts/bundle-models.mjs`

## Testing

- Verify `EmbeddingDiagnostics` correctly reports baseline state and missing assets.
- Verify `project_manage doctor` diagnoses remote enablement and missing models.
