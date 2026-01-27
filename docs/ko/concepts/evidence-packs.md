# 증거 팩(Evidence Packs) & 아티팩트

Kairo는 "evidence-first"를 지향합니다. 정답만 주는 것이 아니라, 에이전트가 **빠르게 검증**할 수 있도록 돕는 것이 핵심입니다.

## 용어 정의

- **Artifact**: 가져올 수 있는 큰 데이터 패키지의 일반 용어(`artifactId`로 식별). 필요할 때만 fetch.
- **Evidence pack**: 아티팩트의 특정 타입으로, 검증 데이터 포함(파일 발췌, 검색 스코어, 분석 세부정보).

모든 evidence pack은 artifact이지만, 모든 artifact가 evidence pack은 아닙니다.

## 인라인 evidence vs pack


일반적으로 Kairo는:

- **인라인 evidence**: 답을 빠르게 정당화할 최소 근거(파일 경로, 발췌, 검색 히트)
- **Artifacts**: 필요할 때 `manage`로 가져오는 더 깊은 자료(evidence packs)

이렇게 하면 기본 응답은 compact하게 유지하면서, 필요한 순간에는 깊이를 확보할 수 있습니다.

## evidence pack 가져오기

응답에 artifact id가 포함되면 다음처럼 fetch 합니다:

```json
{
  "command": "artifact",
  "target": "<artifactId>",
  "detail": "full"
}
```

프레임워크 팁:

- 아티팩트는 “드릴다운 UI”로 취급하세요(답을 먼저 보여주고, 근거는 펼쳐보기).
- 깊이는 프롬프트로 늘리기보다 **artifacts**로 확장하는 쪽이 안정적입니다.

## 왜 이것이 신뢰(호출 빈도)를 올리나

에이전트는 아래 조건에서 도구를 더 자주 호출합니다:

- 기본 응답이 작고 빠름
- 근거를 “비용 낮게” 추가로 확인 가능
- 실패가 “다음 조치가 명확한 형태”로 나옴(artifact fetch, reindex 등)

