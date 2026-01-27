# 운영 런북 (런치 + 반복 개선)

이 런북은 MCP autopilot/preset 레이어의 OSS 런치 체크리스트와, 런치 이후 반복 개선 루프를 다룹니다.

## 런치 준비 체크리스트

1) 빌드 + 코어 테스트
- `npm run build`
- `npm run build:core-rs` (플랫폼에 따라 필요)
- `npm run test:dist:single dist/tests/integration/McpHostCompatibility.e2e.test.js`
- `npm run test:perf:dist` (선택: dist/performance suite)

2) SLO 게이트
- `npm run benchmark:adr-084-task-slo`
- `npm run benchmark:adr-078-cost-slo`
- `npm run benchmark:adr-085-search-slo`
- `npm run benchmark:adr-088-search-accuracy`

3) 스모크 테스트
- `npm run smoke:mcp-mock-client`
- `npm run smoke:adr-084-beta-log`
- `npm run smoke:adr-084-hardening`
- `npm run smoke:adr-088-compact-guidance`
- `npm run smoke:adr-088-stdio-guidance-closure`
- `npm run smoke:adr-088-change-write-minimal-apply`
- `npm run smoke:adr-088-change-write-deep`
- `npm run smoke:adr-088-stdio-stress`

4) 문서
- `docs/guides/getting-started.md`
- `docs/reference/configuration/index.md`
- `docs/guides/promptless-integration.md`

5) 릴리스 위생
- `LICENSE`와 `README.md`가 정확한지 확인
- 다운스트림 레포에서 `.kairo/`가 ignore 되는지 확인

CI 자동화:
- `.github/workflows/adr-088-verification.yml` (수동 workflow_dispatch)

## 런치 후 반복 개선 루프

매주:
- beta telemetry에서 새로운 `contractFindings` 패턴을 검토
- `mcp.json` preset 기본값(timebox, envelope)을 재평가
- `docs/guides/promptless-integration.md`의 호스트 특이사항(quirks) 목록 업데이트

매월:
- 대표 레포에서 SLO 게이트 재실행
- deprecation triage 및 warnings/docs 업데이트
- 상위 실패 모드를 정리하고 신규 autopilot guardrail 반영 여부 결정

회귀(regression)가 보이면:
- 코드보다 먼저 preset/policy(정책/설정)를 롤백한 뒤, 필요하면 코드 롤백
- `manage({ command: "status" })`와 `manage({ command: "doctor" })`로 호스트 설정을 검증
- beta logs에서 `errorCode` / `degradedReasons`를 확인
