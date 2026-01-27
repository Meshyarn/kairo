# 세션(Session) & 멀티스텝 워크플로우

Kairo는 여러 호출이 이어지는 "writer-style" 워크플로우를 지원합니다.

## 세션이란?

`sessionId`는 Kairo가:

- 도구 호출을 서로 연관시키고,
- 중간 산출물(artifacts)을 재사용하며,
- change/write 멀티스텝 흐름을 더 명확히(draft, warnings, next calls) 만들 수 있게 합니다.

## 언제 세션을 쓰나

아래 같은 흐름에 권장합니다:

- 멀티스텝 조사(explore → understand → plan)
- draft를 반복적으로 다듬는 계획 루프
- write/apply/verify 루프

## 예제: 전체 Writer's Flow

```typescript
// 1단계: 조사 (선택사항)
// 새 세션을 시작해서 모든 후속 호출 연관시키기
// research: { sketch: true }로 개념 추출 수행
const exploreRes = await task({
  request: "인증 모듈 구조 찾기",
  mode: "ask",
  sessionId: "new"  // 새 세션 시작
});

const sessionId = exploreRes.sessionId;  // 다음 호출을 위해 유지

// 2단계: 깊은 분석
// 세션 아티팩트 재사용 (1단계와 동일 임베딩/클러스터)
// vibe.extract=true: 핵심 추상화 식별
// analysis.clusters=true: 관련 코드를 의미론적으로 그룹화 (GraphRAG 필요)
const analyzeRes = await task({
  request: "인증 흐름 설명 및 보안 문제 식별",
  mode: "analyze",
  budget: "balanced",
  sessionId  // 세션 재사용
});

// 3단계: 변경 계획
// 여전히 동일 세션 사용 → 캐시된 임베딩으로 더 빠름
// safety: "plan"은 적용하지 않고 변경만 계산
const planRes = await task({
  request: "Plan: auth/jwt.ts의 JWT 검증 강화",
  mode: "plan_change",
  targetFiles: ["src/auth/jwt.ts"],
  sessionId
});

// 적용 전 계획 검사
console.log("Draft ID:", planRes.draftId);
// workflowWarnings는 누락된 전제조건 표시 (예: "GraphRAG 필요")
console.log("경고:", planRes.workflowWarnings);

// 4단계: 변경 적용
// safety: "apply"는 draftId + applyToken으로 계획 실행
// 게이트됨: 토큰은 1회성이므로 apply는 신중하게
const applyRes = await task({
  mode: "apply_change",
  draftId: planRes.draftId,
  applyToken: planRes.applyToken,
  sessionId
});

console.log("적용됨:", applyRes.result.changedFiles);
```

**핵심 포인트:**

- `sessionId: "new"`로 시작하여 세션 시작
- 모든 후속 호출에서 `sessionId` 유지
- 재사용된 산출물(임베딩, 클러스터)로 더 빠른 흐름
- `workflowWarnings`는 누락된 전제조건(GraphRAG 설정 등) 표시
- `guidance.nextCalls`는 다음 단계 호출 템플릿 제공

## 프레임워크 팁

- 프레임워크 레벨에서 워크플로우 동안 `sessionId`를 유지하세요.
- `guidance.nextCalls`가 있으면 가능한 한 그대로 실행하세요(올바른 id/token 포함).

Compact 패턴은 아래 참고:

- [에이전트 플레이북](/ko/agent/AGENT_PLAYBOOK)


