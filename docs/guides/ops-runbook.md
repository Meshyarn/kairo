# Ops Runbook (Launch + Iteration)

This runbook covers the OSS launch checklist and the post-launch iteration loop for the MCP autopilot/preset layer.

## Launch readiness checklist

1) Build + core tests
- `npm run build`
- `npm run build:core-rs` (if needed for your platform)
- `npm run test:dist:single dist/tests/integration/McpHostCompatibility.e2e.test.js`
- `npm run test:perf:dist` (optional: dist/performance suite)

2) SLO gates
- `npm run benchmark:adr-084-task-slo`
- `npm run benchmark:adr-078-cost-slo`
- `npm run benchmark:adr-085-search-slo`
- `npm run benchmark:adr-088-search-accuracy`

3) Smoke tests
- `npm run smoke:mcp-mock-client`
- `npm run smoke:adr-084-beta-log`
- `npm run smoke:adr-084-hardening`
- `npm run smoke:adr-088-compact-guidance`
- `npm run smoke:adr-088-stdio-guidance-closure`
- `npm run smoke:adr-088-change-write-minimal-apply`
- `npm run smoke:adr-088-change-write-deep`
- `npm run smoke:adr-088-stdio-stress`

4) Docs
- `docs/guides/getting-started.md`
- `docs/reference/configuration/index.md`
- `docs/guides/promptless-integration.md`

5) Release hygiene
- Ensure `LICENSE` and `README.md` are accurate
- Confirm `.kairo/` is ignored in downstream repos

CI automation:
- `.github/workflows/adr-088-verification.yml` (manual workflow_dispatch)

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
