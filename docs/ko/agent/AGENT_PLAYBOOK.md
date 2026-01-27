# 에이전트 플레이북

> **Public surface** — compact (`task`/`manage`) 또는 Five Pillars

---

## 프롬프트리스 기본값(compact surface)

`KAIRO_MODE=mcp`(기본값)일 때, 대부분의 호스트는 `task` + `manage`만 보게 됩니다(`KAIRO_PUBLIC_SURFACE=compact`).

권장 흐름:

```typescript
// 1) Ask / read-only: 기본 질문 답변
task({ request: "auth flow를 요약해줘." })

// 2) Analyze: 구조와 관계 이해 (중간 깊이)
task({ request: "아키텍처와 핵심 모듈을 설명해줘.", mode: "analyze", budget: "balanced" })

// 3) Deep evidence: 전체 세부정보 + 깊은 아티팩트 (비용 많음)
const analysis = await task({ request: "아키텍처와 핵심 모듈을 설명해줘.", mode: "analyze", budget: "deep" })
// 있으면 전체 아티팩트 가져오기 (두 번째 fetch, 지연 로딩)
await manage({ command: "artifact", target: analysis.artifacts?.[0]?.id, detail: "full" })

// 4) Plan change (prep-only): edits 미제공 → 템플릿 제안만
const prep = await task({ request: "JWT 검증을 강화해줘.", mode: "plan_change", targetFiles: ["src/auth/jwt.ts"] })

// 5) Plan change (실제 plan): edits 제공 → draftId + applyToken 반환 (MCP 모드)
const plan = await task({ request: "JWT 검증을 강화해줘.", mode: "plan_change", edits: prep.changePrep?.editsTemplate?.edits })

// 6) Apply: draftId + applyToken 모두 필요 (1회성, 게이트됨)
await task({ request: "계획을 적용해줘.", mode: "apply_change", draftId: plan.draftId, applyToken: plan.applyToken })
```


Notes:
- `mode="auto"`는 변경을 적용(apply)하지 않습니다(server-gated).
- `mode="write"` / `mode="verify"`는 compact surface에서 지원됩니다(ADR-086). pillar별 전체 옵션이 필요하면 pillar 도구를 사용하세요.
- 전체 스키마가 필요하면 `manage({ command: "schema", tool: "task", detail: "full" })`를 사용하세요.
- `task`가 `status="partial_success"`와 함께 `guidance.nextCalls`를 반환하면, 그 호출을 따르세요(필요 시 compact-safe 도구로 재작성됨).
- MCP 모드의 apply 흐름에서는 가능하면 `guidance.nextCalls`를 우선 따르세요(올바른 `draftId/applyToken`과 세션 컨텍스트를 포함). 수동으로 apply 할 때 최소 계약은 `draftId + applyToken`이며, write draft target path를 오버라이드하지 마세요.
- evidence pack이 필요하면 `budget="deep"`을 사용하고, 더 깊이가 필요하면 `manage({ command: "artifact", target, detail: "full" })`로 후속 호출하세요.

---

## Five Pillars(pillars surface)

| Pillar | 의도(Intent) | 예시 |
|--------|--------|----------|
| **`explore`** | 찾기/읽기 | 검색, preview, full reads |
| **`understand`** | 코드 이해 | 아키텍처, call graphs, dependencies |
| **`change`** | 코드 수정 | dry-run & impact를 포함한 안전한 편집 |
| **`write`** | 파일 생성 | 생성, 스캐폴딩 |
| **`manage`** | 상태 제어 | undo/redo, status, rebuild |

**원칙:** **"무엇(What)"**(intent)을 표현하면 → 시스템이 **"어떻게(How)"**(execution)를 처리합니다.

---

## 공통 패턴

### 1. Analyze → Modify
```typescript
// Step 1: Understand
understand({ goal: "UserService의 auth 로직을 이해해줘" })

// Step 2: Plan (server-gated; MCP 모드에서 draftId/applyToken 반환)
const plan = await change({ intent: "도메인 allowlist를 추가해줘", safety: "plan" })

// Step 3: diff + impact 검증

// Step 4: Apply (MCP 모드에서는 반환된 applyToken 필요)
await change({ ...plan, safety: "apply" })
```

### 1.2 StrategySearch (Best-of-N / MCTS)

2개 이상의 후보 패치를 구체적인 `edits`로 제공할 수 있다면, `strategySearch`로 dry-run 기반 후보 비교 및 선택이 가능합니다.

```typescript
const plan = await change({
  intent: "JWT 검증을 강화해줘",
  targetFiles: ["src/auth/jwt.ts"],
  safety: "plan",
  options: { includeImpact: true },
  strategySearch: {
    mode: "force",
    stage: "r1",
    candidates: [
      { id: "safe_small", edits: [{ filePath: "src/auth/jwt.ts", targetString: "OLD", replacementString: "NEW1" }] },
      { id: "fast_big", edits: [{ filePath: "src/auth/jwt.ts", targetString: "OLD", replacementString: "NEW2" }] }
    ]
  },
  trace: true
})
```

R3(MCTS)는 `children` 트리 + `mcts` 설정으로 bounded search를 수행합니다. 전체 schema/output 상세는 `docs/ko/agent/TOOL_REFERENCE.md`를 참고하세요.

### 1.5 Writer's Flow (리뷰 품질 최상)

**Writer's Flow를 써야 하는 이유?**

표준 워크플로우(ask → plan → apply)는 매번 비용 많은 분석을 반복합니다. Writer's Flow는 **세션**을 사용해:
- **재사용**: 임베딩과 클러스터를 여러 호출에 재사용 (더 빠름)
- **갭 표시**: `workflowWarnings`로 누락된 것 표시 (예: "GraphRAG 필요")
- **깊은 리뷰**: 캐시된 아티팩트로 가능 (더 좋은 품질)

멀티스텝 워크플로우(explore → understand → refine → plan → apply)가 예상될 때 세션 사용.

```typescript
// Step 0: Start a session
const { sessionId } = await explore({ query: "auth flow", research: { sketch: true }, sessionId: "new" })

// Step 1: Build session artifacts once
await understand({
  goal: "src/auth",
  sessionId,
  vibe: { extract: true, scope: "src/**/*.ts" },
  analysis: { clusters: true }
})

// Step 2: Plan first
const plan = await change({ intent: "JWT 검증 강화", targetFiles: ["src/auth/jwt.ts"], safety: "plan", sessionId })

// Step 3: Apply
await change({ ...plan, safety: "apply", sessionId })
```

Tips:
- `workflowMeta` + `workflowWarnings`는 레거시 호출을 깨지 않으면서도 누락된 세션 아티팩트를 가시화합니다.
- `analysis.clusters=true`는 GraphRAG가 활성화되어야 합니다(`KAIRO_GRAPHRAG_ENABLED=true` 또는 `.kairo/config/graphrag.json`).
- semantic findings가 apply를 차단하게 하려면 `reviewOptions.blockOn=["semantic"]`을 설정하고 `.kairo/config/symbolic-guards.json`으로 symbolic guards를 활성화하세요(ADR-083).


### 2. Search → Deep Dive
```typescript
// Step 1: Find
explore({ query: "PaymentProcessor" })

// Step 2: Preview results

// Step 3: Full read (if needed)
explore({ paths: ["src/payments/Processor.ts"], view: "full" })
```

Tip: 결과가 비어 보이거나(stale)하다면 `manage({ command: "status" })`로 `nativeSearch`/`drift`를 확인하고, 필요하면 `manage({ command: "reindex" })`를 실행하세요.

---

## 응답 구조

모든 응답은 **`guidance`**를 포함합니다:
- `message` — 무엇을 달성했는지
- `suggestedActions` — 다음 단계(**우선순위 높게**)
- `warnings` — 리스크(God Modules, blast radius)

---

## Layer 3 AI 기능

**선택적 고급 기능**(ADR-042-006, 기본 비활성):

| Feature | ENV Flag | 설명 |
|---------|----------|-------------|
| Smart Fuzzy Match | `KAIRO_LAYER3_SMART_MATCH=true` | 임베딩 기반 심볼 해석 |
| AST Impact | `KAIRO_LAYER3_SYMBOL_IMPACT=true` | 변경 영향 자동 감지 |
| Code Generation | `KAIRO_LAYER3_CODE_GEN=true` | 패턴 인지 기반 생성 |

---

## 내부 도구(Opt-in)

**ENV Flags:**
- `KAIRO_EXPOSE_INTERNAL_TOOLS=true` — list에 내부 도구 표시
- `KAIRO_EXPOSE_FILE_TOOLS=true` — list에 파일 단위 유틸리티 표시

**권장:** pillar가 아닌 도구는 불안정하다고 보고, 최선의 결과를 위해 Five Pillars를 직접 사용하세요.
