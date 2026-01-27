# ADR-054: Cross-Language Contract Awareness

**Status:** Implemented (NAPI baseline)  
**Date:** 2026-01-10  
**Related:** `docs/adr/ADR-053-H-universal-hybrid-architecture.md`, `docs/adr/ADR-053-L-language-support-levels.md`, `docs/adr/ADR-053-C-managed-config-bootstrap.md`

ADR-054 defines a **Boundary Adapter framework** for cross-language “contract awareness” (discovery → contract surface → manifest → diff → impact linking). The first implementation target is **NAPI (Rust ↔ TS/JS)** via `@kairo/core-rs`, with **field-level impact** and **degraded reason reporting** implemented. The architecture is intended to expand to other L2/L3 languages through additional adapters (IDL/OpenAPI, SQL schema/migrations, JNI/CGO/Python/PHP extensions).

The support goal aligns with `ADR-053-L`: L3 boundaries must not silently pass when contract/manifest evidence is missing; they should return explicit degraded reasons and `manage doctor` guidance.

## Decision

- Model cross-language relationships as **boundary instances** (FFI/IDL/HTTP/Data), discovered from repo evidence.
- Persist contract surfaces as **auto-generated manifests** under `.kairo/contracts/...` and reuse them for diff + impact.
- When manifests are missing, return explicit **degraded** reasons and `manage doctor` guidance (no silent pass, especially for L3).

## Rollout (High Level)

- Phase 0: Adapter/manifest baseline + `manage doctor --scope=contracts` (done)
- Phase 1: NAPI adapter (package alias ↔ linked repo, d.ts-based manifests, TS consumer impact) (done)
- Phase 2: Field-level linking + cross-language degraded reasons in tool responses (done)
- Phase 3+: IDL (OpenAPI/Proto), SQL schema/migrations, other FFI boundary expansion (planned)
