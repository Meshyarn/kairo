# ADR-017: Context-Aware Clustered Search (Historical)

**Status:** Proposed

## Context

Flat keyword search results are hard for agents to use:

- Too many unrelated hits (token waste).
- No relationship context (call chains, type families, module boundaries).
- Forces repeated “discover clusters by trial-and-error” workflows.

## Decision

Introduce a `ClusterSearchEngine` that returns **clusters** optimized for agent consumption:

- Identify seed symbols that match the query.
- Expand related symbols by relationship type (callers/callees, type hierarchy, colocated, module
  edges, siblings).
- Attach metadata that helps the agent choose an entry point (relevance score, cluster type,
  token estimate, suggested start file).

## Consequences

Moves search from “list of hits” to “navigable map”, reducing follow-up calls to understand how
symbols connect.

