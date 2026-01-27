# 기술 용어 정의

Kairo 문서에서 자주 사용되는 기술 용어를 정의합니다.

## A

**Artifact**  
`manage({ command: "artifact", target: "<id>" })`로 가져올 수 있는 데이터 패키지입니다. 검증 데이터, 분석 결과 또는 증거 팩을 포함합니다. 응답의 `artifactId`로 식별됩니다.

**Adaptive LOD** (Level of Detail)  
[LOD](#l) 참고.

## D

**Drift** (불일치)  
Kairo의 내부 파일 인덱스가 **실제 파일시스템과 다른 상태**입니다. 다음 상황에서 감지됩니다:
- Kairo 외부에서 파일 편집 (사용자 직접 편집, 다른 도구)
- 파일 삭제 또는 이름 변경
- 호출 간 디스크 내용 변경

Kairo는 drift가 감지되면 **위험한** 편집을 차단합니다. [혼합 워크플로우 탄력성 (ADR-077)](/ko/adr/ADR-077-mixed-workflow-resilience)과 [안전한 쓰기](/ko/concepts/safe-writes)를 참고하세요.

**Drift 검사**  
Kairo의 워크스페이스 drift 감지 메커니즘입니다. `manage({ command: "status" })`로 확인: `status.drift.workspaceDrift`.

## E

**Embeddings** (임베딩)  
텍스트의 벡터 표현입니다. Kairo는 선택적 **벡터 검색**(의미론적 유사성)을 위해 임베딩을 사용합니다. 임베딩은 로컬에서 계산되고 빠른 검색을 위해 인덱싱됩니다. `KAIRO_GRAPHRAG_ENABLED=true` 또는 `.kairo/config/graphrag.json` 설정 필요. [검색 & 임베딩](/ko/guides/search-and-embeddings) 참고.

**Evidence pack** (증거 팩)  
검증 데이터(파일 발췌, 검색 스코어, 분석 세부정보)를 포함하는 아티팩트 유형입니다. 모든 증거 팩은 아티팩트입니다.

## G

**GraphRAG**  
그래프 기반 검색-증강 생성(Graph-based Retrieval-Augmented Generation). Kairo에서 GraphRAG는 다음을 지원합니다:
- **클러스터 분석**: 관련 코드를 의미론적 클러스터로 그룹화
- **벡터 임베딩**: 코드/문서를 의미론적 공간에 매핑하여 유사도 검색 가능
- **엔티티 추출**: 핵심 추상화 및 관계 식별

`KAIRO_GRAPHRAG_ENABLED=true` 또는 `.kairo/config/graphrag.json`로 활성화. [검색 & 임베딩](/ko/guides/search-and-embeddings) 참고.

## L

**LOD** (상세도 수준, Level of Detail)  
Kairo가 수집할 컨텍스트 양을 제어하는 예산/깊이 파라미터:
- **Shallow** (얕음): 빠르고 최소 컨텍스트 (예: 상위 5개 파일만)
- **Balanced** (균형): 중간 깊이 (예: 상위 20개 파일, 얕은 클러스터링)
- **Deep** (깊음): 비용 많음, 완전한 분석 (예: 전체 클러스터링, 모든 증거)

도구 호출에서 `budget: "lean" | "balanced" | "deep"`으로 설정. LOD는 토큰 사용량, 타임아웃, 결과 품질에 영향.

**Lexical search** (렉시컬 검색)  
키워드와 정확한 일치 기반의 전문 텍스트 검색입니다. Kairo의 네이티브 검색 코어(Tantivy 기반)는 외부 의존성 없이 빠른 렉시컬 검색을 제공합니다. 선택적 벡터 검색과 함께 사용하여 더 풍부한 결과 제공. [오프라인 베이스라인](/ko/concepts/offline-baseline) 참고.

## M

**MCTS** (Monte Carlo Tree Search, 몬테카를로 트리 탐색)  
Kairo의 전략 평가에 사용되는 검색 알고리즘:
- 여러 후보 해결책 경로 탐색
- 예상 품질로 순위 지정
- 완전 열거 없이 최고의 전략 선택

`plan_change` 전략 선택에 내부적으로 사용. 설정: `strategySearch.mcts` ([ADR-080](/ko/adr/ADR-080-strategy-search-and-mcts) 참고).

## P

**Promptless** (프롬프트리스)  
자연어 프롬프트 대신 **구조화된 파라미터**로 작동하는 워크플로우 설계 원칙입니다. 이렇게 하면 모호함이 제거되고, 신뢰성이 향상되고, 도구 동작이 결정론적입니다. 모든 Kairo 도구는 promptless 설계를 사용합니다.

**Public Surface** (공개 표면)  
MCP 호스트와 에이전트에 노출된 도구 집합:
- **Compact** (MCP 모드 기본): `task`, `manage`
- **Pillars** (`KAIRO_PUBLIC_SURFACE=pillars`로 opt-in): `explore`, `understand`, `change`, `write`, `manage`

[공개 표면](/ko/concepts/public-surface) 참고.

## S

**Session** (세션)  
여러 도구 호출 간 아티팩트와 분석을 유지하는 상태 저장 워크플로우 컨텍스트(`sessionId`):
1. **Explore** (선택적 조사)
2. **Understand** (분석 + 클러스터링)
3. **Change/Write** (먼저 plan, 그 다음 apply)

세션은 비용이 많이 드는 중간 결과(임베딩, 클러스터) **재사용**을 가능하게 합니다. [세션](/ko/concepts/sessions) 참고.

**Stdio** (표준 입출력)  
MCP가 사용하는 통신 프로토콜입니다. Kairo는 stdio 서버로 실행되며, stdin에서 JSON 라인 요청을 읽고 stdout으로 응답을 씁니다. 타임아웃과 권한은 MCP 호스트에서 관리합니다.

## T

**Tokenizer** (토크나이저)  
텍스트를 LLM 사용을 위한 토큰으로 변환하는 유틸리티:
- Kairo 컨텍스트에서: 예산 상한을 시행하기 위해 토큰 개수를 셉니다.
- `output.maxTokens` 시행에 내부적으로 사용
- 제약 환경(예: 요청당 한계가 있는 MCP 호스트)에서 응답 오버플로우 방지

## V

**Vector search** (벡터 검색)  
임베딩을 사용한 의미론적 검색입니다. 쿼리와 문서를 벡터로 변환하고 유사도를 계산합니다. 키워드 대신 "의미로 검색" 가능. Kairo에서 선택사항 (GraphRAG 활성화 시 지원). [오프라인 베이스라인](/ko/concepts/offline-baseline) 참고.

---

더 많은 컨텍스트:
- [개념](/ko/concepts/) — 핵심 아이디어 설명
- [아키텍처 (ADRs)](/ko/adr/) — 설계 결정 및 근거
