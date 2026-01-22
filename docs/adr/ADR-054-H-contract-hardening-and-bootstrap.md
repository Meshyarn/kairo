# ADR-054-H: Contract Hardening & Bootstrap Alignment (NAPI)

**Status:** Implemented (0.4.0)  
**Scope:** Rust ↔ TS/JS via NAPI (`ffi_napi`)  
**Related:** `docs/adr/ADR-054-cross-language-contract-awareness.md`, `docs/adr/ADR-053-C-managed-config-bootstrap.md`, `docs/adr/ADR-055-universal-parity-and-standardization.md`

## Why

ADR-054’s “cross-language contract awareness” was **weakly coupled in real-world usage**, causing the following recurring issues:

- If `.kairo/contracts` was missing, users had to create it manually.
- Even with a manifest, consumer (importers) linking was weak, so TS consumers could be missing from `impactReport`.

## What changed

- **Root-fixed contracts path**: contract manifests are always stored under the Kairo execution root at `.kairo/contracts/<kind>/...`
- **Auto-generate (from `.d.ts`)**: when a manifest is missing/invalid, auto-generate it from the `.d.ts` entry (supports environments where builds are not possible).
- **Consumer linking standardization**
  - 1st: `DependencyGraph.getImporters(entryPath)`
  - 2nd (fallback): `project_search`-based consumer discovery + explicit `cross_lang_contract_degraded`
- **Report UX alignment**: cross-language consumer files are reflected not only in `impactReport.crossLangImpact.consumerFiles` but also in `impactReport.preview.summary.impactedFiles` (prevents the “looks empty” problem).
- **Producer change detection hardening**: when a public surface change is detected, force degraded mode even if the contract diff is empty, and provide consumer discovery + guidance.

## Notes

- `impactReport` is produced when `change` is called with `options.includeImpact: true` (a request option, not a config file setting).
  - Kairo can suggest re-calling with `includeImpact` when it detects signals that impact analysis should be enabled (e.g., potential public API changes).

