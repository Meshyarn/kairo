# 가이드

이 가이드는 실제 에이전트 작업 중 Kairo가 **자주** 그리고 **안정적으로** 호출되길 원하는
에이전트 프레임워크 / MCP 호스트 개발자(및 고급 사용자)를 위해 작성되었습니다.

권장 읽기 순서:

1. [시작하기](/ko/guides/getting-started) — 빌드/실행 + stdio 런치 기본
2. [프롬프트리스 MCP 연동](/ko/guides/promptless-integration) — Kairo를 설정하는 표준 방법 (compact 기본값)
3. [에이전트 프레임워크 연동](/ko/guides/agent-framework-integration) — 호스트 구현 체크리스트(타임아웃, 로깅)
4. [검색 & 임베딩](/ko/guides/search-and-embeddings) — 오프라인 우선 모델 + 인덱싱 워크플로우
5. [운영 런북](/ko/guides/ops-runbook) — 런치 체크리스트 + 반복 개선 루프

## 고급 & 레퍼런스

- [설정(분할 레퍼런스)](/ko/reference/configuration/) — 읽기 쉬운 설정 레퍼런스
- [원문 콘텐츠 전달(write/change)](/ko/guides/raw-content) — 템플릿/생성 텍스트의 따옴표/이스케이프 깨짐 방지
- [언어 지원](/ko/guides/language-support) — 지원되는 파일 타입 및 파싱
- [설정(전체 환경 변수; 레거시)](/ko/guides/configuration)
