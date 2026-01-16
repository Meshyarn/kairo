# ADR-076 (요약): Symbol Semantic Search E2E (integrate or deprecate)

## 의도

- 심볼 시맨틱 검색이 “있는 척”만 하는 상태를 제거하고, opt-in으로 실제 동작 경로를 연결한다.
- 기본 OFF 유지 + 명시적 build/search 트리거로 안전하게 운영한다.
- degradedReasons/action으로 준비/정책 문제를 명확히 안내한다.

## 진행 상황

- SymbolEmbeddingIndex의 indexAll 실구현 + symbolId 포맷/파싱 도입.
- 심볼 임베딩을 문서 임베딩과 분리된 modelKey로 저장/검색.
- `project_manage symbol_index_*`(build/status/clear) 명시적 트리거 추가.
- `project_search semanticSymbols=true` opt-in 경로 + fallback(name search) + degradedReasons 적용.
- SearchEngine의 심볼 인텐트 경로는 `semanticSymbols=true`일 때만 동작.
- 증분 인덱싱 훅 + 상한(maxFiles/maxSymbols/bytes/timeout) 적용.
- 증분 인덱싱 시 mtime 캐시로 불필요한 재임베딩을 best-effort로 스킵.
- `relationship_analyze`에서 `semanticSymbols=true`(예: understand depth=deep)일 때 심볼 해석 보조 경로 제공.

## 구현 상태

- [x] Phase A: 최소 연결(indexAll 1회) + degradedReasons/action 표준화
- [x] Phase B: 증분 인덱싱/캐시/상한
- [x] Phase C: 워크플로우 결합 재평가/폐기
