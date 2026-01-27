# ADR-051: Review Quality + Session UX for Writer’s Flow (Historical)

**Status:** In progress (target: `0.2.x`)

## Context

After implementing Writer’s Flow (ADR-050), two gaps remained:

- Review reports weren’t trustworthy enough when “alignment” scores were placeholders.
- Session reuse was not smooth: style/draft/review artifacts required manual re-threading, and
  “refine the draft” loops were not first-class.

## Decision

Improve review quality and session UX without adding new public tools:

- Implement **vibe alignment scoring** with real signals and evidence (integrated with
  `reviewOptions` policies like warn/block).
- Make **session-default reuse** the normal path (latest StylePack reused automatically) and
  support **draft refinement via `draftId`**.
- Add **session persistence/indexing + summaries** so work can be resumed and understood later.
- Adjust defaults so the ADR-050 workflow becomes the “natural” path, not optional glue code.

## Consequences

Increases trust in “review before apply” and reduces repetition across multi-step writing sessions.

