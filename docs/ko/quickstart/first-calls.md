# 첫 호출

아래 호출은 "프롬프트리스" 통합 환경에서도 잘 동작하도록 설계된 기본 패턴입니다.

## 1) 상태 확인: status

Target tool: `manage`

```json
{ "command": "status" }
```

**예상 응답 구조:**

```json
{
  "success": true,
  "status": {
    "global": { "totalFiles": 123, "indexedFiles": 123, ... },
    "nativeSearch": { "available": true, "docCount": 500 },
    "drift": { "workspaceDrift": "clean" }
  }
}
```

**성공 지표:** `success: true` + `drift.workspaceDrift: "clean"` + `nativeSearch.available: true`

---

## 2) 엔트리포인트 찾기

Target tool: `task`

```json
{ "request": "프로그램 엔트리포인트를 찾고, 시작 흐름을 요약해줘.", "mode": "ask" }
```

**예상 응답 구조:**

```json
{
  "success": true,
  "summary": { "title": "엔트리포인트", "bullets": ["..."], "next": "..." },
  "evidence": [
    { "path": "src/index.ts", "kind": "file", "excerpt": "..." }
  ],
  "artifacts": [...]
}
```

**성공 지표:** `success: true` + `summary.bullets` 비어있지 않음 + `evidence` 배열 최소 1개 항목

---

## 3) 아키텍처 설명

Target tool: `task`

```json
{ "request": "프로젝트 아키텍처를 설명해줘(주요 모듈과 데이터 흐름).", "mode": "analyze", "budget": "balanced" }
```

**예상 응답 구조:**

```json
{
  "success": true,
  "summary": { "title": "아키텍처", "bullets": [...], "next": "..." },
  "evidence": [
    { "path": "src/core/Engine.ts", "kind": "file", "score": 0.95 },
    { "path": "docs/ARCHITECTURE.md", "kind": "doc", "excerpt": "..." }
  ],
  "artifacts": [ { "id": "arch_pack_123", "kind": "evidence", "summary": "..." } ]
}
```

**성공 지표:** 응답에 `evidence`의 코드 파일 + 문서 포함 + `artifacts` 배열 비어있지 않음 (깊은 분석용)

---

## 4) 더 깊은 근거 요청(artifact)

응답이 `artifacts` 항목을 언급하면, 상세 정보를 fetch합니다:

```json
{ "command": "artifact", "target": "<artifactId>", "detail": "full" }
```

**예상 응답 구조:**

```json
{
  "success": true,
  "artifact": {
    "id": "arch_pack_123",
    "kind": "evidence",
    "summary": "...",
    "files": [
      { "path": "src/core/Engine.ts", "role": "primary", "excerpt": "..." },
      { "path": "src/core/Worker.ts", "role": "supporting" }
    ]
  }
}
```

**성공 지표:** `success: true` + `artifact.files`에 경로와 발췌 정보 포함

---

## Next: 안전한 편집 (plan → apply)

코드 수정은 2단계 패턴을 따릅니다:

1. **Plan**: `task({ request: "Plan: ...", mode: "plan_change" })` → `draftId` 획득
2. **Apply**: `task({ ..., mode: "apply_change", draftId, applyToken })` → 성공 확인

전체 예제는 [안전한 쓰기 활성화](/ko/quickstart/enable-writes)를 참고하세요.

---

더 많은 패턴: [에이전트 플레이북](/ko/agent/AGENT_PLAYBOOK)

