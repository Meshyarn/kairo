# ADR-042 Series: Production Baseline (P0–P2) + Editor (PH) + Layer 3

**Status:** Implemented (curated)  
**Intent:** Move `kairo` from “prototype” to “production-grade local server”: offline-first, scalable, measurable, and safer-to-edit.

This document is a curated summary of:

- ADR-042-001 (P0): observability + offline baseline
- ADR-042-002 (P1): hybrid ANN + search scaling
- ADR-042-003 (P2): quantization + IO scaling
- ADR-042-004/005 (PH): change/write + editor overhaul
- ADR-042-006: Layer 3 AI-enhanced features

### P0: Observability + Offline baseline

- Run reliably without network and without native DB dependencies where possible
- Collect key metrics to make regressions visible

### P1: Hybrid search

- Combine multiple signals (e.g. filename/text/vector) to improve recall/precision
- Optional vector index for scale, without making it mandatory

### P2: Persistence and scaling

- Reduce memory pressure via persistence and compact formats
- Keep iteration and caching bounded to avoid OOM on large repos

### PH: Editor and batch operations

- Improve edit reliability and batch change paths (including dry-run and rollback where applicable)
- Make “resolve → apply” more explicit for safer edits

### Layer 3: AI-enhanced features (optional)

- Smart fuzzy match (symbol-aware resolution when exact string matching fails)
- AST-aware impact hints
- Style-aware generation (quick generation + pattern-based generation)

## Rejected alternatives

- Network-first / hosted dependency as a requirement: rejected; Kairo must run locally and offline-first.
- “Single mandatory vector DB” architecture: rejected; vector indexing is optional and should not be a hard dependency.
- Always-on deep analysis everywhere: rejected; scale features should be opt-in and degrade gracefully under budgets.

## Revisit criteria

Revisit these rejections only if a hosted mode can be made strictly optional (never required for core operation) and materially improves reliability at scale.

## Implementation notes (current repo)

Performance/observability:

- `src/utils/MetricsCollector.ts`
- `src/vector/*` (vector index support)
- `src/indexing/*` (persistence, indexing, repositories)

Editor + change/write:

- `src/engine/EditResolver.ts`
- `src/engine/EditCoordinator.ts`
- `src/orchestration/pillars/change/*`
- `src/orchestration/pillars/WritePillar.ts`

Layer 3 building blocks:

- `src/engine/IntentToSymbolMapper.ts`
- `src/engine/SymbolImpactAnalyzer.ts`
- `src/generation/*` (style inference, template generation, pattern extraction)

## Operational guidance

- Treat performance features as opt-in knobs: start simple, enable scaling features when the repo size demands it.
- Prefer dry-run planning before apply for any non-trivial change.
