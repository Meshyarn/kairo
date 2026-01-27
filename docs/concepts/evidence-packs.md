# Evidence Packs & Artifacts

Kairo is "evidence-first": the goal is not just to answer, but to help an agent **verify** quickly.

## Terminology

- **Artifact**: General term for any large, retrievable data package (identified by `artifactId`). Artifacts are fetched on demand.
- **Evidence pack**: A specific type of artifact containing verification data (file excerpts, search scores, analysis details).

All evidence packs are artifacts, but not all artifacts are evidence packs.

## Inline evidence vs packs


Kairo generally returns:

- **Inline evidence**: enough to justify the answer cheaply (file paths, excerpts, search hits).
- **Artifacts**: optional deeper material (evidence packs) that can be fetched on demand via `manage`.

This keeps the default output compact while preserving depth when needed.

## Fetching an evidence pack

When a response includes an artifact id, fetch it:

```json
{
  "command": "artifact",
  "target": "<artifactId>",
  "detail": "full"
}
```

Framework guidance:

- Treat artifacts as “drill-down” UI: show the answer first, then allow expanding evidence.
- Prefer deep follow-ups via **artifacts**, not by increasing tool surface.

## Why this improves agent trust

Agents call tools more often when:

- Answers are compact and fast by default.
- Evidence is accessible without re-running expensive calls.
- Failure modes are actionable (e.g., “fetch artifact X”, “reindex these paths”).

