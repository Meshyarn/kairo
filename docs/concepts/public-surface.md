# Public Surfaces: `compact` vs `pillars`

Kairo exposes two “public surfaces” so frameworks can choose **stability** and **call frequency** first, then opt into deeper controls when needed.

## Compact (recommended)

Default in `KAIRO_MODE=mcp`:

- Tools: `task`, `manage`
- Goal: keep the surface **small and stable**, so generic MCP hosts and agent frameworks can route calls without bespoke prompts.

Practical effect:

- Agents are more likely to call tools when the surface is predictable.
- Frameworks can implement one routing strategy (`task` first) and still cover most workflows.

## Pillars (advanced)

Optional via `KAIRO_PUBLIC_SURFACE=pillars`:

- Tools: `explore`, `understand`, `change`, `write`, `manage`
- Goal: expose per-pillar knobs (profiles/limits/advanced options) for power users and complex flows.

## Mapping: intent → what to call

Use this as a framework routing heuristic (not a strict rule):

| You want… | Start with | Notes |
|---|---|---|
| Quick repo understanding | `task({ mode:"ask"|"analyze" })` | Most workflows should begin here. |
| Deeper evidence | `manage({ command:"artifact" })` | Fetch packs referenced by `task`. |
| Plan a safe edit | `task({ mode:"plan_change" })` | In compact surface, plan produces a `draftId` (+ `applyToken` in MCP mode). |
| Apply a planned edit | `task({ mode:"apply_change" })` | Prefer executing `guidance.nextCalls` verbatim. |
| Create a new file safely | `task({ mode:"write", safety:"plan" })` | Two-phase write flows are server-gated in MCP mode. |
| Apply a write draft | `task({ mode:"write", safety:"apply" })` | Requires `draftId + applyToken` in MCP mode. |
| Full control over search/explore | `explore` / `understand` | Use pillars when you need per-tool controls. |
| Complex edit workflows | `change` / `write` | Pillars expose richer change/write knobs. |

For the exact contract and failure modes, see:

- [Tool Reference](/agent/TOOL_REFERENCE)
- [ADR-084](/adr/ADR-084-mcp-autopilot-and-preset-layer)
- [ADR-086](/adr/ADR-086-task-compact-change-write-verify)

