# ADR-046: Semantic Validation Layer for Edit Operations

**Status:** Deferred (curated)  
**Intent:** Make “safe changes” mean more than “the patch applied” by adding optional semantic/syntax validation to edit flows.

Text-based edits can succeed while still being wrong:

- syntax errors (missing braces/imports)
- broken references (renames not applied everywhere)
- architecture violations (cross-layer dependency leaks)

This ADR proposes a **semantic validation layer** that can be used during `change`/`write` (dry-run and/or apply), while keeping Kairo’s core guarantees:

- offline-first operation
- minimal default dependencies
- Five Pillars public surface (no new public tool)

## Context

Kairo already uses transactional edits, guardrails, and evidence-driven workflows. However, “string-match succeeded” is not the same as “change is correct”.

The challenge is that “semantic correctness” varies by language and typically depends on heavyweight tooling (typecheckers, compilers, LSP servers).

## Decision

1) Keep semantic validation **optional** and **best-effort**.
2) Prefer **portable** validation signals first:
   - tree-sitter parsing (syntax-level sanity)
   - project-local commands (tests/build) invoked explicitly by the user/agent via `manage({ command: "test" })` or repo scripts
3) Integrate validation as a **mode inside existing pillars** (primarily `change`/`write`), not as a new public tool.

## Rejected alternatives (for now)

- **Mandatory LSP servers per language**: rejected/deferred due to operational complexity, uneven language support, and additional runtime dependencies.
- **Mandatory build/test on every apply**: rejected because it is too slow/unreliable across repositories and environments; it should remain an explicit gate.
- **Remote validation service**: rejected because it breaks offline-first and introduces privacy/compliance concerns.
- **Bundling language toolchains in Kairo**: rejected because it balloons install size and maintenance burden.

## Deferred items

- Per-language “semantic correctness” plugins (type-aware rename validation, reference resolution).
- Richer structured “review reports” returned by `change`/`write` (beyond warnings/blocked).
- More precise impact analysis for edits (symbol graph + call graph) as a default.

## Revisit criteria

Consider revisiting this ADR if:

- there’s a stable, low-friction way to run syntax/semantic checks across multiple languages locally
- the runtime can include optional validators without harming offline-first and install simplicity
- the ecosystem standardizes MCP host capabilities to pass through toolchain access safely

## Implementation notes (current repo)

Today, Kairo leans on:

- transactional edit coordination: `src/engine/EditCoordinator.ts`
- guardrails + integrity checks: `src/orchestration/guardrails/IntegrityGuardrails.ts`, `src/integrity/*`
- portable parsing/extraction building blocks (where available): `src/ast/*`, `src/ast/extraction/*`

Additionally, a lightweight semantic review surface is implemented:

- `ReviewReport.semantic` is populated during `change`/`write` review:
  - name/link validation (`SemanticValidator`)
  - language-agnostic symbolic guards (query pack + bounded cost)
  - contract guard diagnostics for boundary surface changes
- See `docs/adr/ADR-083-language-agnostic-symbolic-guards.md` for the concrete shipped shape and configuration.

Practical “semantic validation” (typecheck/build/test) is still performed as an explicit final gate (via `manage({ command: "test" })` or repo scripts).
