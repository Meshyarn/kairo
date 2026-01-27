# ADR-016: Impact Flow Analysis & Call Graph Visualization (Historical)

**Status:** Proposed → Phase 1 implemented (Dec 2025)

## Context

File-level dependency graphs and raw reference search were not enough to answer:

- “If I change this function, what breaks downstream?”
- “Who calls this, and through what chain?”

Agents needed symbol-level impact views without relying on external language servers.

## Decision

Add symbol-centric impact analysis:

- **CallGraphBuilder:** build caller/callee edges using `SymbolIndex`, `ModuleResolver`, and
  Tree-sitter call-site extraction; handle import aliases/default exports best-effort.
- **Tool:** `analyze_symbol_impact(symbolName, filePath, direction, maxDepth)` returning a bounded
  call graph + visited/truncation metadata.
- **Cache integrity:** invalidate call graph caches on writes/edits/undo and index rebuilds so
  impact results stay fresh.

## Consequences

Enables “impact-aware change planning” and reduces the number of agent turns required to assess
risk before editing.

