# ADR-054-H: Contract Hardening & Bootstrap Alignment (NAPI)

**Status:** Implemented (0.4.0)  
**Scope:** Rust ↔ TS/JS via NAPI (`ffi_napi`)  
**Related:** `docs/adr/ADR-054-cross-language-contract-awareness.md`, `docs/adr/ADR-053-C-managed-config-bootstrap.md`, `docs/adr/ADR-055-universal-parity-and-standardization.md`

## Why

ADR-054의 “cross-language contract awareness”가 **실사용에서 약하게 결합**되어 다음 문제가 반복됐다.

- `.kairo/contracts`가 없으면 사용자가 수동으로 넣어야 했음
- manifest가 있어도 consumer(importers) 결합이 약해 `impactReport`에서 TS consumer가 누락될 수 있었음

## What changed

- **Root-fixed contracts path**: contract manifest는 항상 Kairo 실행 루트의 `.kairo/contracts/<kind>/...`에 저장
- **Auto-generate (d.ts 기반)**: manifest missing/invalid 시 `.d.ts` entry로부터 자동 생성(빌드 불가 환경 고려)
- **Consumer linking 규격화**
  - 1차: `DependencyGraph.getImporters(entryPath)`
  - 2차(fallback): `project_search` 기반 consumer 탐색 + `cross_lang_contract_degraded` 명시
- **Report UX 정렬**: cross-lang consumer 파일은 `impactReport.crossLangImpact.consumerFiles` 뿐 아니라 `impactReport.preview.summary.impactedFiles`에도 반영(“빈 리스트처럼 보이는” 문제 방지)
- **Producer change 감지 보강**: public surface 변경이 감지되면 contract diff가 비어도 degraded로 강제하여 consumer 탐색/가이던스 제공

## Notes

- `impactReport`는 `change` 호출 시 `options.includeImpact: true`일 때 생성된다. (설정 파일이 아니라 요청 옵션)
  - Kairo는 “impact가 켜질 만한 상황(공개 API 변경 징후)”에서 `includeImpact` 재호출을 가이드로 제안할 수 있다.

