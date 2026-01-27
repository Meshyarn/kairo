# 언어 지원 레벨 (L2/L3)

이 가이드는 Kairo의 언어 지원 티어와 언어별로 무엇을 기대할 수 있는지 설명합니다.

## 지원 레벨

### L2 (Understand-grade)
- 네비게이션을 위한 안정적인 구조 추출(imports/symbols/skeleton)
- best-effort 파싱(갭이 있으면 degraded 신호가 발생할 수 있음)
- 편집은 가능하지만 degraded 경고를 내보내는 것이 정상

### L3 (Edit-safe)
- 문법 검증이 필수이며 실패 시 **차단(blocking)**
- 구조 추출이 impact 분석에 충분할 정도로 신뢰 가능
- 기본적으로 guardrails를 포함한 safe-by-default 편집 흐름
- query packs 또는 parser assets 누락 시 L3 흐름은 차단되며, degraded 이유와 함께 행동 가이드를 제공해야 함

## 현재 타겟 매트릭스

L3: Python, JavaScript, TypeScript, Java, Go, Rust, PHP, SQL  
L2: C/C++, C#, Docs (Markdown 및 유사 문서 포맷)

## 언어 추가 방법

1) `src/config/LanguageConfig.ts`에 확장자 매핑 추가
2) `src/queries/<languageId>/` 아래에 query packs 추가:
   - `imports.scm`, `exports.scm`, `symbols.scm`, `skeleton.scm`
   - (선택) symbolic guards: `guards.scm` (ADR-083)
3) `wasm/tree-sitter-<languageId>.wasm` 제공(또는 `KAIRO_WASM_DIR` 설정)
4) `src/config/LanguageParityMatrix.ts`에 지원 레벨과 parity 요구사항을 등록
5) `npm run validate:languages` 실행
6) `npm run validate:parity` 및 (권장) `npm run test:dist:single dist/tests/languages/LanguageParity.test.js` 실행

## L3로 승격

L2 언어를 L3로 승격하기 전에 다음을 만족해야 합니다:
- 문법 검증이 존재하고 invalid edit을 차단함
- 필수 query packs가 모두 존재함
- imports/exports/symbols/skeleton 테스트가 준비됨

## 트러블슈팅

- Parser 로드 실패: `wasm/tree-sitter-<languageId>.wasm` 존재 확인 또는 `KAIRO_WASM_DIR` 설정
- Query pack 누락: `src/queries/<languageId>/`에 `imports/exports/symbols/skeleton`이 있는지 확인(또는 parity matrix의 `requiredQueries` 목록 확인)
- Symbolic guards 누락: `src/queries/<languageId>/guards.scm` 추가(ADR-083 rule-only symbolic checks)
- Validation degraded: `npm run validate:languages`에서 missing assets 확인
- Guidance에 `manage doctor` 액션이 언급되는 경우 parity/language assets 누락 가능성 점검
- Syntax validator 누락: syntax validation provider가 활성/가용 상태인지 확인(`manage doctor --scope=parity`와 runtime capability diagnostics 참고)

## 유용한 진단

- `manage({ command: "doctor", scope: "languages" })`: languageId/확장자 매핑 이슈
- `manage({ command: "doctor", scope: "parity" })`: query packs + WASM grammar 가용성(정책 인지)

