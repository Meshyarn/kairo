# 설정(Configuration)

Kairo는 주로 환경 변수와, 대상 프로젝트 루트의 `.kairo/` 아래에 있는 소수의 설정 파일로 구성됩니다.

다섯 가지만 먼저 설정한다면:

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact`
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`

## 분할 레퍼런스(권장)

전체 환경 변수 목록은 큽니다. 필요한 항목을 빨리 찾으려면 아래 분할 페이지를 사용하세요:

- [기본(Basics)](/ko/reference/configuration/basics)
- [프로젝트 설정 파일](/ko/reference/configuration/project-files)
- [로깅 & 텔레메트리](/ko/reference/configuration/logging-and-telemetry)
- [검색 & 임베딩](/ko/reference/configuration/search-and-embeddings)
- [성능 & 인덱싱](/ko/reference/configuration/performance)
- [change/write & drift](/ko/reference/configuration/change-write-and-drift)
- [스토리지 & prune](/ko/reference/configuration/storage)
- [문서 & 파서](/ko/reference/configuration/documents-and-parsers)
- [토큰 예산](/ko/reference/configuration/budgets)
- [롤아웃 & 실험](/ko/reference/configuration/rollouts)
- [고급 튜닝](/ko/reference/configuration/advanced)

## 전체 목록(단일 페이지)

단일 파일에서 `grep` 하는 것을 선호한다면, 전체 환경 변수 레퍼런스는 여기 있습니다:

- [설정(전체 환경 변수)](/ko/guides/configuration)
