# ADR-006: Intelligent Orchestration Layer (Historical; Superseded)

**Status:** Superseded by ADR-033 (2024-12-19)

## Context

Early agent workflows required many low-level calls (search → read → analyze → edit → verify),
causing token waste and fragile recovery when operations failed.

## Decision

Introduce an orchestration layer organized around “pillars” (intent categories), with an intent
router that selects the right workflow and returns richer, structured outputs:

- Pillars: **understand**, **change**, **navigate**, **read**, **write**, **manage**
- Shared infrastructure: search, skeleton generation, dependency/call graphs, impact analysis,
  transactions/history

## Notes (How It Evolved)

ADR-033 formalizes and expands this into the Six Pillars architecture, and later ADRs further
curate the public tool surface.

