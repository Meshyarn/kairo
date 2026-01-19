# ADR-070: Offline Baseline Policy (remote embeddings, model packaging)

**Status:** Implemented (Phase A/B/C)  
**Date:** 2026-01-14  
**Related:** `src/embeddings/*`, `scripts/bundle-models.mjs`, `src/handlers/ManageHandlers.ts`, `src/orchestration/capabilities/TokenizerDiagnostics.ts`

## Summary

오프라인 기준선을 명확히 하고 remote 임베딩은 명시적 opt-in으로만 허용한다. 모델 번들은 기본값을 minimal로 정리하고, 런타임/doctor에서 동일한 탐색 규칙으로 진단한다.

## Decision

- offline baseline을 A(core) / B(embeddings-ready)로 구분해 진단한다.
- remote 다운로드는 `KAIRO_EMBEDDING_PROVIDER=remote`에서만 허용하며, doctor/status에 노출한다.
- 모델 번들은 minimal 프로파일을 기본으로 하고 매니페스트를 기록한다.

## Implementation Notes

- embedding diagnostics + path resolution: `src/embeddings/EmbeddingDiagnostics.ts`, `src/embeddings/ModelPaths.ts`
- runtime model lookup 정합화: `src/embeddings/TransformersEmbeddingProvider.ts`, `src/orchestration/capabilities/TokenizerDiagnostics.ts`
- doctor/status 노출: `src/handlers/ManageHandlers.ts`
- doc search degraded reasons: `src/documents/search/DocumentSearchEngine.ts`
- bundle 프로파일/매니페스트: `scripts/bundle-models.mjs`

## Testing

- `EmbeddingDiagnostics`가 baseline 상태와 누락 자산을 올바르게 보고하는지 확인한다.
- `project_manage doctor`에서 remote 활성/모델 누락이 진단되는지 확인한다.
