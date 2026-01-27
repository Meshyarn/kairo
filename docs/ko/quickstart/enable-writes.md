# 안전한 쓰기 활성화 (plan → apply)

Kairo는 프레임워크가 편집을 활성화하더라도 모든 호출이 위험한 "자동 적용"이 되지 않도록 설계되어 있습니다.

## 권장 흐름

1. Plan 먼저 (draft + token 발급)
2. diff를 사람 (또는 프레임워크의 리뷰 게이트)에게 보여주기
3. 제공된 id/token으로 apply
4. verify

---

## Compact 표면 예제

Compact 모드(`task`)에서 고수준 패턴:

### Step 1: Plan

```json
{
  "request": "Plan: src/auth/jwt.ts에서 JWT 검증 강화하기",
  "mode": "plan_change",
  "targetFiles": ["src/auth/jwt.ts"]
}
```

**응답:**

```json
{
  "success": true,
  "draftId": "draft_abc123",
  "applyToken": "token_xyz789_onetime",
  "summary": {
    "title": "JWT 검증 강화",
    "bullets": [
      "알고리즘 화이트리스트 확인 추가",
      "발급자(issuer) 클레임 검증",
      "만료 시간 여유 추가 (5분 버퍼)"
    ]
  },
  "evidence": [
    { "path": "src/auth/jwt.ts", "kind": "file", "excerpt": "verify(token) { ... }" }
  ]
}
```

**성공 지표:** `success: true` + `draftId` 존재 + `applyToken` 존재

### Step 2: 검토

사용자 또는 프레임워크에 diff 표시:

```
--- a/src/auth/jwt.ts
+++ b/src/auth/jwt.ts
@@ -5,6 +5,8 @@
 verify(token) {
+  const algorithms = ['HS256', 'RS256'];
+  if (!algorithms.includes(header.alg)) throw new Error('Invalid algorithm');
   const payload = jwt.verify(token, secret);
   return payload;
```

### Step 3: 적용

사용자/프레임워크가 승인한 후에만 진행:

```json
{
  "request": "계획을 적용해줘",
  "mode": "apply_change",
  "draftId": "draft_abc123",
  "applyToken": "token_xyz789_onetime"
}
```

**응답:**

```json
{
  "success": true,
  "result": {
    "changedFiles": ["src/auth/jwt.ts"],
    "summary": "JWT 검증 강화가 성공적으로 적용됨"
  },
  "verification": {
    "draftVersionMatches": true,
    "filesChanged": 1,
    "linesAdded": 3,
    "linesRemoved": 1
  }
}
```

**성공 지표:** `success: true` + `changedFiles` 배열 비어있지 않음 + `verification.draftVersionMatches: true`

### Step 4: 검증 (선택사항)

추가 안전성을 위해 현재 저장소 상태를 draft와 비교:

```json
{
  "request": "변경사항이 예상대로인지 검증해줘",
  "mode": "verify",
  "draftId": "draft_abc123"
}
```

---

## Five Pillars 표면 (고급)

세밀한 제어를 위해 pillar 도구를 직접 사용:

```json
{
  "intent": "JWT 검증 강화",
  "targetFiles": ["src/auth/jwt.ts"],
  "edits": [
    {
      "filePath": "src/auth/jwt.ts",
      "targetString": "verify(token) {",
      "replacementString": "verify(token) {\n  const algorithms = ['HS256', 'RS256'];\n  if (!algorithms.includes(header.alg)) throw new Error('Invalid algorithm');"
    }
  ],
  "safety": "plan"
}
```

`change()` 및 `write()` 파라미터는 [도구 레퍼런스](/ko/agent/TOOL_REFERENCE)를 참고하세요.

---

## 핵심 개념

- **`draftId`**: 이 계획의 고유 식별자. 적용 시 필수.
- **`applyToken`**: 일회용 소비 가능 토큰 (MCP 모드). 실수로 인한 재적용 방지.
- **Drift 감지**: 계획 이후 파일이 변경되면 `applyToken` 거부. 새 토큰을 받으려면 재계획.
- **`mode="verify"`**: 현재 파일을 draft와 비교 (선택 안전 확인).

더 자세한 정보:

- [안전한 쓰기 개념](/ko/concepts/safe-writes)
- [도구 레퍼런스](/ko/agent/TOOL_REFERENCE)

