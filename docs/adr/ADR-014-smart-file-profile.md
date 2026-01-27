# ADR-014: Smart File Profile (Token-Efficient Default Reads) (Historical)

**Status:** Proposed (2025-12-09)

## Context

Returning raw file content by default caused:

- Token waste (agents often only need structure/signatures).
- Missing metadata/semantic context (deps, usage).
- Higher risk of agents “rewriting” instead of making surgical changes.

## Decision

Redesign default file reads to return a structured “Smart File Profile”:

- Metadata (size, line count, language).
- Structure/skeleton (AST-derived signatures).
- Dependency summary (imports/exports + resolved edges).
- Usage/impact hints (incoming import count + sample files).
- Guidance on how to request full content or targeted fragments.

Raw content remains available behind an explicit flag.

## Consequences

Moves the retrieval UX toward progressive disclosure: show structure first, then opt into raw
content only when necessary.

