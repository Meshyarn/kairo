# ADR-050: Writer’s Flow (Research → Analyze → Skeleton → Write → Review → Manage)

**Status:** Accepted (curated; not yet fully rolled out)  
**Intent:** Provide a repeatable “vibe coding” workflow on top of the Five Pillars without adding new public tools.

## Summary

In practice, teams don’t fail because they can’t call tools—they fail because they skip steps:

- editing before understanding the module boundaries
- generating code that doesn’t match repo conventions (“vibe mismatch”)
- applying changes without an explicit review gate (guardrails/validation)

Writer’s Flow is a **workflow contract** that sequences existing pillars:

1) Research (`explore`)
2) Analyze (`understand`)
3) Skeleton (structured outline + style/pattern signals)
4) Write (`write` / `change`, starting with dry-run)
5) Review (guardrails + validation + tests)
6) Manage (`manage`: undo/redo/history/reindex/test)

## Decision

1) Keep Five Pillars as the only public surface.
2) Make “vibe” and “review” explicit:
   - generation should be informed by style/pattern signals
   - apply should be gated by guardrails/validation
3) Prefer artifact-like outputs (packs/reports) that can be iterated without re-reading the entire repo.

## What is already implemented vs planned

This ADR is a **workflow contract**. In `0.1.0`, treat it as guidance: the system contains many building blocks, but the flow is not “enforced” end-to-end.

Already implemented (building blocks exist):

- Dry-run-first edits and transactional operations (change/write paths)
- Guardrails + integrity checks integrated into apply paths
- Style inference + pattern extraction + template generation for write flows

Planned/iterative (to make the contract explicit end-to-end, without new public tools):

- richer “review report” structures returned by `change` / `write`
- more explicit “style pack” output from `understand` for reuse across a session

## Practical guidance

- If you want the best results:
  - `explore` small, expand as needed
  - `understand` before `change`
  - dry-run → apply
  - use `manage({ command: "test" })` or your repo’s tests as the final gate
