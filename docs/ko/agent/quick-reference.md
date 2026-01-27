# 빠른 참고서 (에이전트 프레임워크 개발자)

이 문서는 MCP 호스트/프레임워크에서 Kairo를 통합할 때 필요한 실전 치트시트입니다.

## 권장 기본값

compact + promptless 친화 설정을 권장합니다:

- `KAIRO_MODE=mcp`
- `KAIRO_PUBLIC_SURFACE=compact` (기본 도구: `task`, `manage`)
- `KAIRO_TOOL_SCHEMA_MODE=compat`
- `KAIRO_LOG_TO_FILE=true`
- `KAIRO_ALLOW_STDOUT_LOGS=false`

## 자주 쓰는 호출 (Compact Surface)

### Ask / 요약

```json
{ "request": "엔트리포인트를 요약해줘." }
```

### Analyze (더 깊게)

```json
{ "request": "아키텍처를 설명해줘.", "mode": "analyze", "budget": "balanced" }
```

### Deep evidence pack (progressive disclosure)

```json
{ "request": "근거와 함께 아키텍처를 설명해줘.", "mode": "analyze", "budget": "deep" }
```

그 다음, artifact를 조회합니다:

```json
{ "command": "artifact", "target": "<artifactId>", "detail": "full" }
```

### Plan → Apply (change)

Plan (`draftId` + `applyToken`을 반환; MCP 모드):

```json
{ "request": "JWT 검증을 강화해줘.", "mode": "plan_change", "targetFiles": ["src/auth/jwt.ts"] }
```

Apply (가능하면 edits를 다시 보내지 마세요):

```json
{ "request": "계획을 적용해줘.", "mode": "apply_change", "draftId": "<draftId>", "applyToken": "<applyToken>" }
```

### Plan → Apply (write)

Write 계획(콘텐츠는 `request` 안에 fenced code block으로 포함):

```json
{
  "request": "`src/foo.ts`를 생성해줘:\\n```ts\\nexport const foo = 1;\\n```",
  "mode": "write",
  "safety": "plan",
  "targetPath": "src/foo.ts"
}
```

Write 적용:

```json
{ "request": "적용해줘.", "mode": "write", "safety": "apply", "draftId": "<draftId>", "applyToken": "<applyToken>" }
```

## 응답 처리 규칙 (호스트/프레임워크)

- `guidance.nextCalls`가 있으면 가능한 한 그대로 실행하세요(올바른 토큰/세션 컨텍스트를 포함).
- `status="blocked"`는 안전/정책 게이트입니다(재계획, scope 축소, fileVersions 갱신).
- `status="partial_success"`는 “가이드가 포함된 성공”입니다(suggested calls를 따라가세요).
- `applyToken`은 **1회성**입니다. 재시도에 재사용하면 안 됩니다.

전체 스키마와 엣지 케이스는 [도구 레퍼런스](/ko/agent/TOOL_REFERENCE)를 참고하세요.

