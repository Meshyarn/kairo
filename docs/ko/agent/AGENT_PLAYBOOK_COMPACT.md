# 에이전트 플레이북 (Compact Surface)

> compact 공개 표면 전용: `task`, `manage`

이 문서는 compact 도구만 노출되는 호스트에서 안정적으로 후속 호출을 수행하기 위한 가이드입니다.

---

## 권장 기본값

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact`
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`

---

## 신뢰할 응답 계약

아래 조건이면 다음 액션을 진행하세요.

- `status`가 `success` 또는 `partial_success`
- 검색 결과가 있을 때 `evidence`가 존재
- top-level `nextCalls`가 존재

특히 apply 흐름은 토큰이 1회성이므로, 수동 재구성보다 `nextCalls`를 우선 실행하세요.

---

## compact 핵심 워크플로우

### 1. Ask (기본 읽기)

```json
{ "request": "Summarize the auth flow." }
```

### 2. Analyze (구조 분석)

```json
{ "request": "Explain module boundaries.", "mode": "analyze", "profile": "balanced" }
```

### 3. Deep evidence + artifact 조회

```json
{ "request": "Explain architecture with evidence.", "mode": "analyze", "profile": "deep" }
```

artifact가 반환되면:

```json
{ "command": "artifact", "target": "<artifactId>", "detail": "full" }
```

### 4. Change 계획 준비(edits 없음)

```json
{
  "request": "Tighten JWT validation.",
  "mode": "plan_change",
  "targetFiles": ["src/auth/jwt.ts"]
}
```

`prepRequired=true`면 반환된 템플릿/타깃으로 `edits`를 채워 다시 `plan_change`를 호출하세요.

### 5. Change 적용 패턴

기본 2단계:

```json
{ "request": "Tighten JWT validation.", "mode": "plan_change", "edits": [{ "filePath": "src/auth/jwt.ts", "targetString": "OLD", "replacementString": "NEW" }] }
```

그 다음:

```json
{ "request": "Apply the plan.", "mode": "apply_change", "draftId": "<draftId>", "applyToken": "<applyToken>" }
```

소규모 1-shot(auto, opt-in):

```json
{
  "request": "Tighten JWT validation.",
  "mode": "plan_change",
  "safety": "auto",
  "targetFiles": ["src/auth/jwt.ts"],
  "edits": [{ "filePath": "src/auth/jwt.ts", "targetString": "OLD", "replacementString": "NEW" }]
}
```

`KAIRO_ENABLE_AUTO_APPLY=true`이고 guardrail 통과 시에만 자동 apply 됩니다.

### 6. Write + verify

write 계획:

```json
{
  "request": "Create src/foo.ts with:\n```ts\nexport const foo = 1;\n```",
  "mode": "write",
  "safety": "plan",
  "targetPath": "src/foo.ts"
}
```

write 적용:

```json
{ "request": "Apply write.", "mode": "write", "safety": "apply", "draftId": "<draftId>", "applyToken": "<applyToken>" }
```

검증:

```json
{ "request": "Verify draft alignment.", "mode": "verify", "draftId": "<draftId>", "targetPath": "src/foo.ts" }
```

---

## compact 운영 규칙

- 용어는 `profile` 우선 (`budget`/`depth`는 alias).
- 고급 제어가 필요할 때만 `pillarOptions` 사용.
- `applyToken`은 1회성으로 취급.
- blocked면 apply 재시도 대신 re-plan.
- `degraded=true`면 우선 `nextCalls` 실행.

---

## 자기 문서화 호출

task 스키마 요약:

```json
{ "command": "schema", "tool": "task", "detail": "summary" }
```

MCP resources:

- `kairo://docs/agent-playbook-compact`
- `kairo://docs/quick-reference`
- `kairo://docs/tool-reference`
