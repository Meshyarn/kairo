# Ops Runbook (Launch + Iteration)

This runbook covers the OSS launch checklist and the post-launch iteration loop for the MCP autopilot/preset layer.

## Launch readiness checklist

1) Build + core tests
- `npm run build`
- `NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=8196" npx jest McpHostCompatibility.e2e.test --runInBand`

2) SLO gates
- `node scripts/adr-084-task-slo-gate.mjs`
- `node scripts/adr-078-cost-slo-gate.mjs`

3) Beta telemetry smoke
- `node scripts/adr-084-beta-log-smoke.mjs`

4) Hardening smoke
- `node scripts/adr-084-hardening-smoke.mjs`

5) Docs
- `docs/guides/getting-started.md`
- `docs/guides/configuration.md`
- `docs/guides/promptless-integration.md`

6) Release hygiene
- Ensure `LICENSE` and `README.md` are accurate
- Confirm `.kairo/` is ignored in downstream repos

## Post-launch iteration loop

Weekly:
- Review beta telemetry for new `contractFindings` patterns
- Re-evaluate `mcp.json` preset defaults (timebox, envelope)
- Update host quirks list in `docs/guides/promptless-integration.md`

Monthly:
- Re-run SLO gates on representative repos
- Triage deprecations and update warnings/docs
- Capture top failure modes and decide new autopilot guardrails

When regressions appear:
- Roll back presets first (policy/config), then code
- Use `manage({ command: "status" })` and `manage({ command: "doctor" })` to validate host configs
- Inspect beta logs for `errorCode` / `degradedReasons`
