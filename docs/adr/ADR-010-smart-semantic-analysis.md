# ADR-010: Smart Semantic Analysis & Structural Navigation (Historical)

**Status:** Proposed

## Context

Regex/text-only operations limited agent workflows:

- Agents had to read whole files to confirm structure (token waste).
- Navigation was “blind” (guess file names / line ranges).
- Regex-based block extraction was fragile in nested/complex syntax.

## Decision

Add an AST-powered semantic layer using Tree-sitter (WASM, cross-platform):

- Introduce an `AstManager` that loads/caches language grammars.
- Provide “structure first” tools (file skeleton / structural outline).
- Support symbol-based reads by using AST node ranges instead of guessed line numbers.

## Consequences

- Better retrieval efficiency (structure compresses large files into small API surfaces).
- More precise extraction, enabling safer downstream edits.

