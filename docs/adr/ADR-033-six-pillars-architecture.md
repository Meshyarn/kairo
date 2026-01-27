# ADR-033: Six Pillars Architecture (Historical)

**Status:** Approved (2025-12-19) — supersedes ADR-006

## Context

Exposing dozens of granular tools created:

- Tool misuse and choice paralysis for agents.
- Reasoning fragmentation across many small calls.
- Excessive schema/token overhead and playbook maintenance cost.

## Decision

Expose a compact “what” interface and move “how” orchestration server-side:

- 6 intent-based pillars: **understand**, **change**, **navigate**, **read**, **write**, **manage**
- An orchestration engine plans workflows, performs eager loading where needed, synthesizes
  guidance, and keeps internal implementation details hidden from the agent.

## Consequences

This is the foundation for later curated tool surfaces: fewer public tools, richer modes/options,
and better end-to-end reliability via centralized orchestration.

