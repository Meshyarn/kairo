# Architecture Decision Records (Curated)

This directory contains a curated set of ADRs for `kairo`.

The upstream project history includes many ADR documents. For OSS readability (and to avoid burying readers in 60+ files), we:

- Keep ~10 “retouched” ADRs that capture the current architecture and why it exists.
- Provide an index that summarizes every other ADR as a short, searchable entry.

If you only read one thing, start with:

- `docs/adr/ADR-040-five-pillars-toolset.md` (public tool surface)
- `docs/adr/ADR-041-integrity-audit-and-guardrails.md` (safety model)
- `docs/adr/ADR-050-writers-flow.md` (workflow contract; artifacts/session support in `0.2.x`)

## Retouched ADRs (canonical for OSS)

- `docs/adr/ADR-040-five-pillars-toolset.md`
- `docs/adr/ADR-041-integrity-audit-and-guardrails.md`
- `docs/adr/ADR-042-series-production-baseline.md`
- `docs/adr/ADR-043-adaptive-context-architecture.md`
- `docs/adr/ADR-044-universal-language-parity.md`
- `docs/adr/ADR-045-modular-architecture.md`
- `docs/adr/ADR-046-semantic-validation-layer.md`
- `docs/adr/ADR-047-multi-repo-multi-language.md`
- `docs/adr/ADR-036-039-universal-documents-and-evidence.md`
- `docs/adr/ADR-050-writers-flow.md`

## Rejected / Deferred decisions (important context)

When reviewing ADR history, “not chosen” decisions matter as much as chosen ones. In this repository, we record them in two ways:

1) **Inside ADRs** via sections like “Non-Goals”, “Out of scope”, “Rejected alternatives”, “Deferred items”.
2) **In this index** as a short list of major “we considered X but didn’t do it” calls.

Major examples (curated):

- **No new `audit` pillar (rejected)**: integrity checks are integrated as modes/options in existing pillars to avoid expanding the public tool surface (`docs/adr/ADR-041-integrity-audit-and-guardrails.md`).
- **Mandatory LSP/typecheck per language (deferred/rejected)**: semantic validation is desirable, but requiring heavy per-language dependencies is deferred; see `docs/adr/ADR-046-semantic-validation-layer.md`.
- **“Return everything” read APIs (rejected)**: designs that flood the agent with raw context were replaced with progressive disclosure (`docs/adr/ADR-040-five-pillars-toolset.md`, `docs/adr/ADR-043-adaptive-context-architecture.md`).
- **Network-first architecture (rejected)**: the baseline is local/offline-first; remote services may be optional later, but not required to run (`docs/adr/ADR-042-series-production-baseline.md`).

If you add new ADRs later, prefer explicitly marking:

- `Status: Accepted | Implemented | Rejected | Deferred | Superseded`
- “Rejected alternatives” (with a one-line reason per alternative)
- “Revisit criteria” (what would need to change for a deferred/rejected option to become viable)

## Full index (every ADR summarized)

The entries below cover all ADRs from the project history. Items marked “retouched” have a dedicated file in this folder; the rest are summarized here.

### Public tool surface & workflows

- ADR-040 (retouched): Five Pillars toolset consolidation → `docs/adr/ADR-040-five-pillars-toolset.md`
- ADR-050 (retouched): Writer’s Flow contract → `docs/adr/ADR-050-writers-flow.md`
- ADR-051: Review quality + session UX → see `docs/agent/TOOL_REFERENCE.md` + `docs/guides/getting-started.md` + `docs/guides/configuration.md`
- ADR-052: Pillar option profiles + session policy → `docs/adr/ADR-052-pillar-option-profiles-and-session-policy.md`
- ADR-053-C (summary): Managed config bootstrap (`manage init/doctor`) → `docs/adr/ADR-053-C-managed-config-bootstrap.md`
- ADR-054 (summary): Cross-language contract awareness (boundary adapters baseline) → `docs/adr/ADR-054-cross-language-contract-awareness.md`
- ADR-054-H (summary): Contract hardening & bootstrap alignment (NAPI) → `docs/adr/ADR-054-H-contract-hardening-and-bootstrap.md`
- ADR-055 (summary): Universal parity & standardization program → `docs/adr/ADR-055-universal-parity-and-standardization.md`
- ADR-056 (summary): Token-aware dynamic context compression (maxTokens + distill) → `docs/adr/ADR-056-token-aware-dynamic-context-compression.md`
- ADR-057: Unified degradedReasons + action guidance v1 → `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`
- ADR-058: Tool schema contract + compatibility layer → `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`
- ADR-059: EvidencePack/Summaries lifecycle (prune/compact) → `docs/adr/ADR-059-evidence-pack-and-summaries-lifecycle-prune-compact.md`
- ADR-060: Document tool parity (PDF/XLSX) → `docs/adr/ADR-060-document-tool-parity-pdf-xlsx.md`
- ADR-062: Multi-repo E2E UX + safety boundaries → `docs/adr/ADR-062-multi-repo-e2e-ux-and-safety-boundaries.md`
- ADR-063: Capability diagnostics + provider policy integration → `docs/adr/ADR-063-capability-diagnostics-and-provider-policy-integration.md`
- ADR-064: FileVersion handshake (read↔apply) → `docs/adr/ADR-064-fileversion-handshake-read-apply.md`
- ADR-065: Change execution contract (atomic apply + delete policy) → `docs/adr/ADR-065-change-execution-contract-atomic-apply-partial-opt-in-delete-policy.md`
- ADR-066: Guardrails override & audit trail → `docs/adr/ADR-066-guardrails-override-and-audit-trail.md`
- ADR-055-H: Adaptive trust policy (no curated summary)
- ADR-055-L: Action guidance + Understand fallback graph (no curated summary)
- ADR-033: “Six Pillars” precursor to ADR-040; introduced orchestration primitives and earlier public surface.
- ADR-019/020: Toolset consolidation strategy (historical); led to the eventual Pillars surface.

### Safety, validation, and reliability

- ADR-041 (retouched): Integrity audit modes integrated into pillars → `docs/adr/ADR-041-integrity-audit-and-guardrails.md`
- ADR-064: FileVersion handshake (read↔apply) → `docs/adr/ADR-064-fileversion-handshake-read-apply.md`
- ADR-065: Change execution contract (atomic apply + delete policy) → `docs/adr/ADR-065-change-execution-contract-atomic-apply-partial-opt-in-delete-policy.md`
- ADR-066: Guardrails override & audit trail → `docs/adr/ADR-066-guardrails-override-and-audit-trail.md`
- ADR-048: Sync feedback loop + architectural safety guardrails (tighten preflight/apply checks).
- ADR-049: Defensive hardening for integrity engine and audit logging.
- ADR-046 (retouched): Semantic validation layer for edit operations (go beyond text-match correctness) → `docs/adr/ADR-046-semantic-validation-layer.md`
- ADR-032: Edit reliability and state synchronization (index staleness + safer applies).
- ADR-024: Edit flexibility + safety improvements (matching strategies, anchors, guards).
- ADR-009 (revised): EditorEngine string matching improvements (historical but still foundational).
- ADR-005: Transactional editing / reliability baseline (undo/redo, backups, safer multi-step changes).
- ADR-008: Pragmatic reliability blueprint (historical).
- ADR-015: Agent experience & resilience improvements (historical).

### Performance, observability, and scaling

- ADR-042 series (retouched): P0–P2 baseline + PH editor + Layer 3 → `docs/adr/ADR-042-series-production-baseline.md`
- ADR-053: Hybrid Rust core phases 1–4 → `docs/adr/ADR-053-hybrid-rust-architecture-and-optimization.md`
- ADR-053-H: Universal hybrid architecture + multi-engine framework → `docs/adr/ADR-053-H-universal-hybrid-architecture.md`
- ADR-053-L (summary): Language support levels (L2/L3) + target matrix → `docs/adr/ADR-053-L-language-support-levels.md`
- ADR-054 (NAPI baseline): Cross-language contract awareness (boundary adapters + field-level impact) → `docs/adr/ADR-054-cross-language-contract-awareness.md`
- ADR-054-H: ADR-054 hardening (bootstrap + deep linking; NAPI Rust ↔ TS/JS)
- ADR-055 (summary): Universal parity & standardization program (schemas + parity gates + adapter expansion) → `docs/adr/ADR-055-universal-parity-and-standardization.md`
- ADR-055-H: Adaptive trust policy (archived; no curated summary)
- ADR-055-L: Action guidance + Understand fallback graph (archived; no curated summary)
- ADR-056 (summary): Token-aware dynamic context compression (maxTokens + distill) → `docs/adr/ADR-056-token-aware-dynamic-context-compression.md`
- ADR-022: Scalable memory architecture (on-disk/lazy/streaming baseline ideas).
- ADR-028: Performance + accuracy enhancements (historical deep dive).
- ADR-029: Production readiness / system maturity (historical).
- ADR-034/035: Adaptive budgets + degraded responses (historical but influences how pillars behave under caps).

### Retrieval, search, and context construction

- ADR-043 (retouched): Adaptive Context Architecture (LOD + UCG) → `docs/adr/ADR-043-adaptive-context-architecture.md`
- ADR-017/017-addendum: Context-aware clustered search; token control; caching refinements.
- ADR-018: Consolidated clustered search (refinement / merged design).
- ADR-014: Smart File Profile (token-efficient default reads, skeleton-first).
- ADR-016: Impact flow analysis and call graph visualization (historical design target; partial realized across multiple modules).

### Language support, query-driven extraction, and multi-repo

- ADR-044 (retouched): Universal language parity via Tree-sitter WASM + query packs → `docs/adr/ADR-044-universal-language-parity.md`
- ADR-047 (retouched): Multi-repo + multi-language expansion → `docs/adr/ADR-047-multi-repo-multi-language.md`
- ADR-062: Multi-repo E2E UX + safety boundaries → `docs/adr/ADR-062-multi-repo-e2e-ux-and-safety-boundaries.md`
- ADR-023: Architectural gap remediation (historic analysis driving extraction/indexing cleanup).
- ADR-031: Unified runtime/testing data layout (historical; influences `.kairo/` shape).

### Documents and evidence

- ADR-036–039 (retouched): Universal documents, retrieval ops, evidence packs → `docs/adr/ADR-036-039-universal-documents-and-evidence.md`
- ADR-038: Token-efficient evidence packs & progressive disclosure (core concept used by `explore`).

### Early foundations (historical)

These are older “why we built this at all” documents. The code has evolved, but the intent is useful context:

- ADR-001: Initial server architecture (historical).
- ADR-002/003/004: Early refactoring + advanced algorithm directions (historical).
- ADR-006: Intelligent orchestration layer (historical).
- ADR-010/011/012: Semantic analysis + robustness + project intelligence (historical).
- ADR-013: External feature analysis (historical).
- ADR-021: Enterprise-grade core enhancements (historical).
- ADR-025/027: UX and indexing synchronization notes (historical).

### “Meta” ADRs / tracking notes

- ADR-042 completion summary: aggregated status report for the 042 series (covered by `docs/adr/ADR-042-series-production-baseline.md`).
- ADR-044 implementation TODO: short ordered checklist (historical; effectively merged into ADR-044 work).
- ADR-045 TODO tracking: internal planning notes (historical; merged into the modularization work).

## Complete ADR list (source titles, condensed)

This list captures every ADR title from the project history and where it’s covered in this curated set.

### Mainline ADRs

- ADR-005: Reliability and Transactional Editing → summarized in this index (see “Safety”)
- ADR-014: Smart File Profile - Token-Efficient Default File Reading → summarized (see “Retrieval”)
- ADR-017 Addendum: Lazy Expansion, Token Control & Caching Refinements → summarized (see “Retrieval”)
- ADR-017: Context-Aware Clustered Search for AI Agents → summarized (see “Retrieval”)
- ADR-018: Context-Aware Clustered Search for AI Agents (Consolidated) → summarized (see “Retrieval”)
- ADR-022: Scalable Memory Architecture (On-Disk, Lazy, Streaming) → summarized (see “Scaling”)
- ADR-023 Enhanced: Architectural Gap Remediation Strategy → summarized (see “Language/Multi-repo”)
- ADR-024: Enhanced Edit Flexibility and Safety → summarized (see “Safety”)
- ADR-026: Symbol Resolution Reliability & AI Agent Workflow Guidance → summarized (see “Safety/UX”)
- ADR-030: Agent-Centric Adaptive Intelligence and Resilience → summarized (see “Orchestration”)
- ADR-032: Edit Code Reliability and State Synchronization → summarized (see “Safety”)
- ADR-033: Intelligent Orchestration Layer - Six Pillars Architecture → summarized (precursor to ADR-040)
- ADR-036: Universal Document Support (Markdown/MDX-first) → `docs/adr/ADR-036-039-universal-documents-and-evidence.md`
- ADR-037: Universal Text + Code Comments + Retrieval Quality + Embedding Ops + Scalable Storage (Docs v2) → `docs/adr/ADR-036-039-universal-documents-and-evidence.md`
- ADR-038: Token-Efficient Evidence Packs & Progressive Disclosure (Agent Token Budget) → `docs/adr/ADR-036-039-universal-documents-and-evidence.md`
- ADR-040: Five Pillars Toolset Consolidation (Explore-first) → `docs/adr/ADR-040-five-pillars-toolset.md`
- ADR-041: Integrity Audit Modes (Cross-source Consistency) — Five Pillars 강화 → `docs/adr/ADR-041-integrity-audit-and-guardrails.md`
- ADR-042-001: P0 Observability + Standalone Baseline (No Network / No Native DB) → `docs/adr/ADR-042-series-production-baseline.md`
- ADR-042-002: P1 Hybrid ANN + Search Scaling (Offline-First) → `docs/adr/ADR-042-series-production-baseline.md`
- ADR-042-003: P2 Vector Quantization + Persistence/IO Scaling (Offline-First) → `docs/adr/ADR-042-series-production-baseline.md`
- ADR-042-004: PH Change/Write (Batch + Latency) → `docs/adr/ADR-042-series-production-baseline.md`
- ADR-042-005: PH Editor Overhaul + Change/Write Completion (No More Follow-ups) → `docs/adr/ADR-042-series-production-baseline.md`
- ADR-042-006: PH Layer 3 AI-Enhanced Features (Smart Fuzzy Match, AST Impact, Code Generation) → `docs/adr/ADR-042-series-production-baseline.md`
- ADR-042 Series Completion Summary → `docs/adr/ADR-042-series-production-baseline.md`
- ADR-043: Adaptive Context Architecture (Adaptive Flow) → `docs/adr/ADR-043-adaptive-context-architecture.md`
- ADR-044 Implementation TODO (Ordered by Risk) → summarized in this index
- ADR-044: Universal Language Parity via Tree-Sitter WASM → `docs/adr/ADR-044-universal-language-parity.md`
- ADR-045: Modular Architecture Optimization & Code Consolidation → `docs/adr/ADR-045-modular-architecture.md`
- ADR-045 TODO Tracking → summarized in this index
- ADR-046: Semantic Validation Layer for Edit Operations → `docs/adr/ADR-046-semantic-validation-layer.md`
- ADR-047: Multi-Repo & Multi-Language Expansion → `docs/adr/ADR-047-multi-repo-multi-language.md`
- ADR-048: Sync Feedback Loop & Architectural Safety Guardrails → summarized in this index (see “Safety”)
- ADR-049: Integrity Engine Defensive Hardening → summarized in this index (see “Safety”)
- ADR-050: Writer's Flow (Research → Analyze → Skeleton → Write → Review → Manage) → `docs/adr/ADR-050-writers-flow.md`
- ADR-061: Language Parity Gates (L2/L3) & Silent-pass 제거 → `docs/adr/ADR-061-language-parity-gates-and-silent-pass-removal.md`
- ADR-064: FileVersion Handshake (read↔apply) → `docs/adr/ADR-064-fileversion-handshake-read-apply.md`
- ADR-065: Change Execution Contract (atomic apply + delete policy) → `docs/adr/ADR-065-change-execution-contract-atomic-apply-partial-opt-in-delete-policy.md`
- ADR-063: Capability Diagnostics & Provider Policy Integration → `docs/adr/ADR-063-capability-diagnostics-and-provider-policy-integration.md`
- ADR-062: Multi-Repo E2E UX & Safety Boundaries → `docs/adr/ADR-062-multi-repo-e2e-ux-and-safety-boundaries.md`
- ADR-063: Capability Diagnostics & Provider Policy Integration → `docs/adr/ADR-063-capability-diagnostics-and-provider-policy-integration.md`

### Archive ADRs (historical)

- ADR-001: Kairo Server Architecture → summarized (see “Early foundations”)
- ADR-002: Smart Engine Refactoring & Tool Separation → summarized (see “Early foundations”)
- ADR-003: Advanced Algorithms Implementation → summarized (see “Early foundations”)
- ADR-004: Agent-Driven Refactoring for Enhanced Safety, Accuracy, and Performance → summarized (see “Early foundations”)
- ADR-006: Intelligent Orchestration Layer (IOL) → summarized (see “Early foundations”)
- ADR-008 (v2): Final Blueprint for Pragmatic Reliability → summarized (see “Safety”)
- ADR-009: EditorEngine String Matching & Performance Improvements (Revised) → summarized (see “Safety”)
- ADR-009: EditorEngine String Matching Improvements → summarized (see “Safety”)
- ADR-009: Memory-Bounded Architecture for Large Projects → summarized (see “Scaling”)
- ADR-009: Persistent Index Layer for Scalable Monorepo Support → summarized (see “Scaling”)
- ADR-010: Smart Semantic Analysis & Structural Navigation → summarized (see “Early foundations”)
- ADR-011: Robustness, Format Flexibility, and Advanced Analysis (Revised) → summarized (see “Early foundations”)
- ADR-012: Project Intelligence (Enhanced Static Analysis) → summarized (see “Early foundations”)
- ADR-013: Serena Feature Analysis & Strategic Enhancement Plan → summarized (see “Early foundations”)
- ADR-015: Agent Experience and Resilience Enhancements → summarized (see “Safety/UX”)
- ADR-016: Impact Flow Analysis & Call Graph Visualization → summarized (see “Retrieval/Analysis”)
- ADR 019: Toolset Consolidation Strategy → summarized (see “Public tool surface”)
- ADR 020: Toolset Consolidation Strategy → summarized (see “Public tool surface”)
- ADR 021: Enterprise-Grade Core Enhancements (Architecture & Algorithms) → summarized (see “Early foundations”)
- ADR 021: Enterprise-Grade Core Enhancements → summarized (see “Early foundations”)
- ADR-025: User Experience Enhancements for Edit Flexibility, Search Refinement, and Batch Operation Guidance → summarized (see “Safety/UX”)
- ADR 027: Fix Indexing Synchronization Issues → summarized (see “Scaling”)
- ADR 027: Implementation Details & Code-Based Design → summarized (see “Scaling”)
- ADR-028: Performance and Accuracy Enhancements for Kairo → summarized (see “Scaling”)
- ADR-029: System Maturity Enhancements for Production Readiness → summarized (see “Scaling”)
- ADR-031: Unified Runtime and Testing Data Structure → summarized (see “Language/Multi-repo”)
- ADR-034: Adaptive Resource Budgets for Navigate/Understand → summarized (see “Scaling”)
- ADR-035: Adaptive Change Execution (Safe‑by‑Default) → summarized (see “Safety”)
- ADR-039: Universal Document Implementation Strategy → `docs/adr/ADR-036-039-universal-documents-and-evidence.md`
