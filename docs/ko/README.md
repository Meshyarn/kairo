# Kairo 문서

이 폴더는 `kairo`를 실행하고 MCP 호스트에 연결하는 데 필요한 최소한의 문서를 포함합니다.

언어 지원:
- English (canonical): `docs/`
- 한국어(영문과 동일한 구조/분량 유지 + 번역): `docs/ko/` (site i18n)

## 시작하기

- `docs/ko/guides/getting-started.md` — 빌드/실행 + CLI 에이전트(Claude/Gemini/Codex CLI) 연결
- `docs/ko/reference/configuration/index.md` — 설정(분할 레퍼런스; 권장)
- `docs/ko/guides/configuration.md` — 설정(전체 환경 변수; 레거시 모놀리식)
- `docs/ko/guides/promptless-integration.md` — 커스텀 프롬프트 없는 최소 MCP 설정
- `docs/ko/guides/ops-runbook.md` — 런치 체크리스트 + 런치 후 반복 루프

빠른 소스 검증은 다음을 참고하세요:
- `npm run smoke:mcp-mock-client`
- `npm run benchmark:adr-085-search-slo`
- `npm run smoke:adr-088-compact-guidance`
- `npm run smoke:adr-088-stdio-guidance-closure`
- `npm run smoke:adr-088-change-write-minimal-apply`
- `npm run smoke:adr-088-change-write-deep`
- `npm run benchmark:adr-088-search-accuracy`

## 에이전트 문서 (권장)

- `docs/ko/agent/TOOL_REFERENCE.md` — 공개 도구 입력 레퍼런스 (`task`/`manage` + pillars)
- `docs/ko/agent/AGENT_PLAYBOOK.md` — 권장 사용 패턴 (evidence packs + compact 후속 호출)

## 아키텍처 (큐레이션 ADR)

- `docs/ko/adr/README.md` — 큐레이션된 ADR 인덱스 + 요약
- `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md` — 프롬프트리스 MCP 기본값 (`task` + presets + handshake)
- `docs/adr/ADR-085-rust-native-search-core-tantivy.md` — 네이티브 검색 코어 (Tantivy via `@kairo/core-rs`)
- `docs/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program.md` — 에이전트 신뢰 검증 프로그램 (E2E harnesses + CI gates)

이 큐레이션된 ADR 외의 상세 레퍼런스는 현재 OSS 문서 세트에서 의도적으로 제외되었습니다.

## 문서 웹사이트 (선택)

이 레포는 `docs/.vitepress/` 아래에 VitePress 문서 사이트 스캐폴드를 포함합니다.

레포 루트에서:

```bash
# 최초 1회 (VitePress 다운로드)
npm --prefix docs install

# 로컬 개발 서버
npm --prefix docs run dev
```

언어 라우트:
- English: `/`
- 한국어: `/ko/`

Last updated: 2026-01-24
