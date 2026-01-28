# 도구 레퍼런스 가이드 (공개 도구 표면)

Kairo는 **두 가지 공개 도구 표면**을 제공합니다(ADR-084):

- **Compact (권장; `KAIRO_MODE=mcp`에서 기본)**: `task`, `manage`
- **Pillars (고급; opt-in)**: `explore`, `understand`, `change`, `write`, `manage` (`task`는 계속 사용 가능)

표면 전환: `KAIRO_PUBLIC_SURFACE=compact|pillars`.

> Tool name note: 일부 MCP 호스트는 tool name에 서버 prefix를 붙여 보여줍니다(예: `kairo_task`). canonical tool name은 `task`, `manage`, `explore`, `understand`, `change`, `write`입니다.

---

## Compact Surface (권장)

### `task`

프롬프트리스 워크플로우(ask/analyze/plan/apply)를 위한 고수준 라우터입니다.

> **Promptless란?** 자연어 프롬프트 대신 **구조화된 파라미터**를 사용하는 워크플로우입니다. 이렇게 하면 모호함이 제거되고 일관된 결과를 얻을 수 있습니다.

**파라미터**

**필수**

| 필드 | 타입 | 비고 |
|---|---|---|
| `request` | `string` | 자연어 요청 (예: "엔트리포인트 찾기"). |

**흐름 제어** (선택사항, 중요)

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `mode` | `"auto" \| "ask" \| "analyze" \| "plan_change" \| "apply_change" \| "write" \| "verify"` | `auto` | `auto`는 apply로 라우팅하지 않습니다. 워크플로우에서는 명시적 mode 사용. |
| `safety` | `"plan" \| "apply"` | — | 힌트 전용(`mode="auto"`에서 사용). 명시적 mode가 우선. |
| `draftId` | `string` | — | **필수** `apply_change`에서. 이전 `plan_change`에서 반환. |
| `applyToken` | `string` | — | **필수** MCP 모드에서 `apply_change`. plan 단계에서 발급. |

**범위 & 타겟팅** (선택사항)

| 필드 | 타입 | 비고 |
|---|---|---|
| `targetFiles` | `string[]` | change plan/apply 범위 제한(blast radius). |
| `paths` | `string[]` | 읽기/검색 힌트 경로. |
| `edits` | `object[]` | `plan_change`에서: 생략하면 prep-only, 포함하면 실제 plan + draft. |

**품질 & 제한** (선택사항)

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `budget` | `"lean" \| "balanced" \| "deep"` | `lean` | 깊이/타임아웃/토큰 예산 프리셋. |
| `output.format` | `"summary" \| "standard"` | policy 기반 | 응답 형태 (MCP 모드에서 보통 `summary`). |
| `output.maxTokens` | `number` | policy 기반 | 응답 토큰 상한. Task는 LOD를 downshift하여 맞춤. |
| `output.maxChars` | `number` | policy 기반 | 응답 문자 상한. |

**세션 & 개선** (선택사항)

| 필드 | 타입 | 비고 |
|---|---|---|
| `sessionId` | `string` | 플로우 세션 id (`"new"`로 새 세션 시작). |
| `refinement` | `string` | 이전 draft 개선 시 추가 가이드. |
| `trace` | `boolean` | 디버깅용 `decisionTrace` + `effectiveOptions` 반환. |

**호환성** (선택사항)

| 필드 | 타입 | 비고 |
|---|---|---|
| `targetPath` | `string` | `targetFiles[0]` alias (호환성 계층). |

**Notes**

- `mode="plan_change"`는 2단계로 동작합니다:
  - `edits` 없이: target hints + `fileVersions` + `editsTemplate`를 반환(prep-only).
  - `edits` 포함: 실제 plan을 수행하고 `draftId` + (`KAIRO_MODE=mcp`에서는) `applyToken`을 반환.
- `mode="apply_change"`는 이전 draft를 apply합니다. `KAIRO_MODE=mcp`에서는 `draftId`와 유효한 `applyToken`이 필요합니다.
  - draft를 apply할 때 보통 `draftId + applyToken`만 필요합니다(`targetFiles`/`edits` 재전송은 선택).
  - `draftId`가 제공되면, 호스트의 sessionId drift에 관대하도록 Kairo가 draft에서 올바른 session을 해석하려 시도합니다(그래도 `sessionId` 전달을 권장).
- `mode="write"` / `mode="verify"`는 compact surface에서 지원됩니다(ADR-086).
- `mode="write"`: `targetPath`(또는 `targetFiles[0]`)를 제공하고, `request` 안에 fenced code block으로 콘텐츠를 포함하세요(예: ```ts ... ```).
  - write draft(`draftId`)를 apply할 때 `targetPath`는 생략할 수 있습니다(draft에서 추론). 제공한다면 draft target과 일치해야 하며, 아니면 apply가 차단됩니다.
- `mode="verify"`: 현재 파일 내용을 draft pack과 비교합니다(`draftId` 제공 시). `Base version`은 pre-apply snapshot 대비 drift 신호이며, draft content가 일치하지 않을 때만 평가됩니다.
- apply 성공 흐름 이후 `task`는 동일 응답에 저비용 `verification` 결과를 임베드할 수 있습니다(`apply_change`, 또는 `mode="write"` + `safety="apply"`).
- 전체 스키마 on-demand: `manage({ command: "schema", tool: "task", detail: "full" })` (artifact id 반환).
- `output.maxTokens/maxChars`는 hard cap이며, `task`는 맞추기 위해 LOD를 downshift하고 inline evidence를 줄입니다.

**Response (`task` 하이라이트)**

- `summary` — title/bullets/next (항상 존재).
- `evidence` — 제한된 evidence 목록(LOD 기반으로 파일 랭킹 및/또는 짧은 발췌).
- `artifacts` — `manage`로 더 깊은 후속 호출을 위한 `evidence` packs(`kind: "evidence"`) 포함.
- `changePrep.targetStringCandidates` — 가능하면 `plan_change`를 위한 제한된 exact anchor 후보.
- `verification` — `mode="verify"`에서 존재하며 apply 성공 흐름에서도 등장할 수 있음.
- `decisionTrace` — `trace: true`일 때 orchestration/LOD 결정.
- `stats.responseBudget` — envelope enforcement가 적용되면 존재.

**사용 예시**

- `task({ request: "엔트리포인트를 요약해줘." })`
- `task({ request: "아키텍처를 설명해줘.", mode: "analyze", budget: "balanced" })`
- `task({ request: "Plan: JWT 검증을 강화해줘.", mode: "plan_change", targetFiles: ["src/auth/jwt.ts"] })` (prep)
- `task({ request: "Plan: JWT 검증을 강화해줘.", mode: "plan_change", edits: [{ filePath: "src/auth/jwt.ts", targetString: "OLD", replacementString: "NEW" }] })` (draft)
- `task({ request: "계획을 적용해줘.", mode: "apply_change", draftId, applyToken })`
- `manage({ command: "artifact", target: "<evidenceId>", detail: "full" })` (deep evidence)

---

## Five Pillars (고급; `KAIRO_PUBLIC_SURFACE=pillars`)

아래 내용은 `src/server/tools/ToolSpecRegistry.ts`에 노출된 **현재 입력 스키마**를 반영합니다.

> Note: `trace: true`가 제공되면 도구는 v1 스키마로 `effectiveOptions`와 `decisionTrace`를 반환합니다:
> - `effectiveOptions.version = 1` (및 `pillar`)
> - `decisionTrace.version = 1` (및 `pillar`, `optionResolution`, `skips`, `events`)

### `explore`

문서/코드를 위한 통합 검색 + 읽기 인터페이스입니다.

**파라미터**

| 필드 | 타입 | 필수 | 비고 |
|---|---|---:|---|
| `query` | `string` |  | 문서/코드 검색 쿼리. |
| `paths` | `string[]` |  | 읽을 파일/디렉터리를 명시. |
| `profile` | `"lean" \| "fast" \| "balanced" \| "deep"` |  | depth/limits/include 기본값 preset. |
| `sources` | `"code" \| "docs" \| "both"` |  | 코드 vs 문서 검색 선호(기본: both). |
| `view` | `"auto" \| "preview" \| "section" \| "full"` |  | 기본값은 token-safe previews. |
| `section.sectionId` | `string` |  | 특정 문서 섹션을 타겟할 때 사용. |
| `section.headingPath` | `string[]` |  | sectionId의 대안. |
| `section.includeSubsections` | `boolean` |  | 섹션 view에서 하위 섹션을 포함. |
| `include.docs` | `boolean` |  | 문서 결과 포함. |
| `include.code` | `boolean` |  | 코드 결과 포함. |
| `include.comments` | `boolean` |  | 코드-코멘트 코퍼스 포함(doc search). |
| `include.logs` | `boolean` |  | `.log` 문서 포함. |
| `include.clusters` | `boolean` |  | GraphRAG 클러스터 요약 포함(활성화 시). |
| `clusterOptions.maxClusters` | `number` |  | 반환할 최대 클러스터 수(profile에 따라 기본값이 다름). |
| `clusterOptions.expansionDepth` | `number` |  | 비용이 큰 그래프 확장의 깊이(best-effort). |
| `clusterOptions.includePreview` | `boolean` |  | 클러스터에 preview/signature 필드 포함(best-effort). |
| `allowCrossRepoEdits` | `boolean` |  | 레포 config가 허용하는 경우 cross-repo 클러스터 확장 허용. |
| `sessionId` | `string` |  | 플로우 세션 id(시작은 `"new"`). |
| `research.sketch` | `boolean` |  | ResearchPack 스케치를 포함. |
| `research.topN` | `number` |  | 스케치의 top modules 상한. |
| `research.format` | `"ascii" \| "mermaid" \| "both"` |  | 스케치 출력 포맷. |
| `packId` | `string` |  | Evidence pack 재사용. |
| `cursor.items` | `string` |  | 결과 페이징(items). |
| `cursor.content` | `string` |  | 재검색 없이 pack에서 콘텐츠 확장. |
| `limits.maxResults` | `number` |  | 그룹별 결과 상한. |
| `limits.maxChars` | `number` |  | 총 콘텐츠 예산(설정 시 응답 envelope 문자 상한으로도 사용). |
| `limits.maxTokens` | `number` |  | 응답 envelope 토큰 예산(최종 tool output JSON). |
| `limits.maxItemChars` | `number` |  | 아이템별 상한. |
| `limits.maxBytes` | `number` |  | full read의 하드 바이트 상한. |
| `limits.maxFiles` | `number` |  | 스캔/고려할 파일 수 상한. |
| `limits.timeoutMs` | `number` |  | 호출 단위 타임아웃 예산(best-effort). |
| `fullPaths` | `string[]` |  | view=full일 때 이 경로만 full content를 포함. |
| `allowSensitive` | `boolean` |  | 민감 파일 opt-in. |
| `allowBinary` | `boolean` |  | 바이너리 파일 opt-in. |
| `allowGlobs` | `boolean` |  | glob 경로 opt-in. |
| `trace` | `boolean` |  | v1 `effectiveOptions` + v1 `decisionTrace` 반환. |

**사용 예시**

- `explore({ query: "AuthService" })`
- `explore({ paths: ["src/auth/AuthService.ts"], view: "full" })`
- `explore({ query: "refund", packId, cursor: { items } })`
- `explore({ research: { sketch: true }, sessionId: "new" })`
- `explore({ query: "ADR-051", profile: "deep", sources: "docs", trace: true })`

---

### `understand`

구조와 관계에 대한 심층 분석(opt-in includes)입니다.

**파라미터**

| 필드 | 타입 | 필수 | 비고 |
|---|---|---:|---|
| `goal` | `string` | ✓ | 이해하고 싶은 대상(symbol/file/free-text). |
| `scope` | `"symbol" \| "file" \| "module" \| "project"` |  | 탐색 모드 범위를 좁힘. |
| `depth` | `"shallow" \| "standard" \| "deep"` |  | 분석 깊이를 제어. |
| `profile` | `"lean" \| "fast" \| "balanced" \| "deep"` |  | 분석 기본값 preset. |
| `sources` | `"code" \| "docs" \| "both"` |  | 코드 vs 문서 선호(참고: 문서 검색 지원은 점진적으로 롤아웃 중). |
| `include.callGraph` | `boolean` |  | call graph 포함(기본은 보수적; 명시적으로 활성화). |
| `include.dependencies` | `boolean` |  | dependency edges 포함. |
| `include.hotSpots` | `boolean` |  | hotspot 신호 포함. |
| `include.pageRank` | `boolean` |  | 아키텍처 중요도 신호 포함. |
| `include.clusters` | `boolean` |  | GraphRAG 클러스터 요약 포함(활성화 시). |
| `sessionId` | `string` |  | 플로우 세션 id(시작은 `"new"`). |
| `vibe.extract` | `boolean` |  | StylePack 생성. |
| `vibe.scope` | `string` |  | 스타일 샘플링 glob scope. |
| `vibe.includeNorms` | `boolean` |  | ADR/README에서 norms 포함. |
| `analysis.clusters` | `boolean` |  | AnalysisPack 생성. |
| `analysis.maxClusters` | `number` |  | 최대 클러스터 수. |
| `analysis.maxFilesPerCluster` | `number` |  | 클러스터당 최대 파일 수. |
| `clusterOptions.maxClusters` | `number` |  | 반환할 최대 클러스터 수(GraphRAG). |
| `clusterOptions.expansionDepth` | `number` |  | 비용이 큰 그래프 확장의 깊이(best-effort). |
| `clusterOptions.includePreview` | `boolean` |  | 클러스터에 preview/signature 포함(best-effort). |
| `allowCrossRepoEdits` | `boolean` |  | 레포 config가 허용하는 경우 cross-repo 클러스터 확장 허용. |
| `limits.timeoutMs` | `number` |  | 호출 단위 타임아웃 예산(best-effort). |
| `limits.maxTokens` | `number` |  | 응답 envelope 토큰 예산(최종 tool output JSON). |
| `limits.maxChars` | `number` |  | 응답 JSON 크기 하드 상한(문자). |
| `trace` | `boolean` |  | v1 `effectiveOptions` + v1 `decisionTrace` 반환. |

**Notes**

- `profile`은 비용 안정성을 위해 명시되지 않으면 자동 downshift 될 수 있습니다. 최종 결정은 `trace: true`로 확인하세요(`decisionTrace`).
- `include.callGraph=true`일 때 `understand`는 `callGraph` 요약과 `callGraphArtifactId`/`callGraphSummary`를 반환하므로, 전체 그래프는 `manage({ command: "artifact", target: <id> })`로 가져올 수 있습니다.

---

### `change`

impact 분석을 포함한 안전한 편집을 plan/apply 합니다.

**파라미터**

| 필드 | 타입 | 필수 | 비고 |
|---|---|---:|---|
| `intent` | `string` | ✓ | 변경 내용을 자연어로 설명. |
| `target` | `string` |  | (선택) 힌트(file/symbol). |
| `targetFiles` | `string[]` |  | blast radius 제한. |
| `edits` | `object[]` |  | 구조화된 edits(고급). |
| `edits[].targetString` | `string` |  | 대상 텍스트(레거시 문자열 전달; `edits[].targetSource` 권장). |
| `edits[].replacementString` | `string` |  | 교체 텍스트(레거시 문자열 전달; `edits[].replacementSource` 권장). |
| `edits[].targetSource` | `object` |  | edit target의 원문 소스(ADR-089). 따옴표/이스케이프가 복잡한 템플릿에 권장. |
| `edits[].replacementSource` | `object` |  | edit replacement의 원문 소스(ADR-089). |
| `fileVersions` | `object` |  | 고급 stale-guard: `{ [relPath]: { expectedVersion?, expectedHash? } }` (보통 `DraftPack.fileVersions` 또는 이전 read에서 획득). |
| `profile` | `"lean" \| "fast" \| "balanced" \| "deep"` |  | review/limits 기본값 preset. |
| `safety` | `"plan" \| "apply"` |  | dry-run 동작에 매핑(plan=true가 기본). |
| `options.dryRun` | `boolean` |  | 기본 동작은 dry-run planning. |
| `draftId` | `string` |  | 이전 DraftPack에서 refinement 루프를 이어감. |
| `applyToken` | `string` |  | `KAIRO_MODE=mcp`에서 `safety:"apply"`에 필요(plan에서 발급). |
| `refinement` | `string` |  | 이전 draft refine에 대한 추가 가이드. |
| `draftOptions.skeletonOnly` | `boolean` |  | skeleton-only DraftPack 출력. |
| `draftOptions.includeImpact` | `boolean` |  | DraftPack에 impact 신호 포함. |
| `reviewOptions.preApply` | `boolean` |  | apply 전 리뷰 수행. |
| `reviewOptions.postApply` | `boolean` |  | apply 후 리뷰 수행. |
| `reviewOptions.strictness` | `"strict" \| "balanced" \| "permissive"` |  | 리뷰 정책. |
| `reviewOptions.blockOn` | `("syntax" \| "semantic" \| "guardrails" \| "vibe")[]` |  | 차단 기준. |
| `sessionId` | `string` |  | 플로우 세션 id(시작은 `"new"`). |
| `stylePack` | `string \| object` |  | StylePack 오버라이드(artifact id 또는 inline pack). |
| `options.includeImpact` | `boolean` |  | `impactReport` 포함(공개 API / cross-language 리스크에서 guidance로 제안될 수 있음). |
| `options.includeSymbolImpact` | `boolean` |  | 심볼 레벨 impact 신호 포함(가능한 경우). |
| `options.autoRollback` | `boolean` |  | Reserved (implementation-dependent). |
| `options.batchMode` | `boolean` |  | Reserved (implementation-dependent). |
| `options.suggestDocs` | `boolean` |  | apply 성공 시 문서 업데이트 제안 활성화. |
| `options.batchImpactLimit` | `number` |  | batch impact preview에 포함할 최대 파일 수. |
| `options.formatter` | `"auto" \| "off" \| "prettier"` |  | apply 후 formatter 실행 opt-in. |
| `strategySearch.mode` | `"off" \| "auto" \| "force"` |  | 기본 `auto`. `off`는 비활성; `force`는 `stage`에서 항상 실행. |
| `strategySearch.stage` | `"r0" \| "r1" \| "r2" \| "r3"` |  | mode가 `off`가 아니면 기본 `r1`. |
| `strategySearch.candidates` | `object[]` |  | mode가 `off`가 아니면 필수. |
| `strategySearch.maxCandidates` | `number` |  | 기본 `2` (hard cap `3`). |
| `strategySearch.timeboxMs` | `number` |  | 기본 `700`. |
| `strategySearch.maxSimulationMs` | `number` |  | 기본 `350`. |
| `strategySearch.maxImpactMs` | `number` |  | 기본 `250`. |
| `strategySearch.maxTouchedFiles` | `number` |  | 기본 `20`. |
| `strategySearch.maxTokensEstimated` | `number` |  | 기본 `2400`. |
| `strategySearch.scoring.weights.*` | `number` |  | files/diff/tokens/risk/breaking/contract/guardsHigh. 가중치. |
| `strategySearch.mcts.*` | `object` |  | R3 전용: `{ maxDepth, maxRollouts, exploration, seed? }`. |
| `trace` | `boolean` |  | v1 `effectiveOptions` + v1 `decisionTrace` 반환. |

**Notes**

- `profile`은 비용 안정성을 위해 명시되지 않으면 자동 downshift 될 수 있습니다. 최종 결정은 `trace: true`로 확인하세요(`decisionTrace`).
- `KAIRO_MODE=mcp`에서는 apply가 기본적으로 server-gated입니다: plan이 `applyToken`을 반환하고, apply는 `draftId + applyToken`을 요구합니다.
- StrategySearch는 opt-in입니다: `strategySearch`를 생략하면 후보 평가는 실행되지 않습니다(R0 baseline).
- `strategySearch.mode`가 `auto`/`force`인데 후보가 없으면, 엔진은 R0로 폴백하고 degraded reason을 반환합니다.
- 따옴표/이스케이프가 민감한 변경은 `edits[].targetSource`/`edits[].replacementSource`를 사용하세요([원문 콘텐츠 전달](/ko/guides/raw-content)).

**StrategySearch candidates**

| 필드 | 타입 | 필수 | 비고 |
|---|---|---:|---|
| `strategySearch.candidates[].id` | `string` | ✓ | 고유 candidate id. |
| `strategySearch.candidates[].label` | `string` |  | `baseline`/`alt` 같은 라벨. |
| `strategySearch.candidates[].intent` | `string` |  | 이 후보의 top-level `intent`를 오버라이드. |
| `strategySearch.candidates[].target` | `string` |  | (선택) `target` 힌트. |
| `strategySearch.candidates[].targetFiles` | `string[]` |  | 이 후보의 blast radius 제한. |
| `strategySearch.candidates[].edits` | `object[]` | ✓ | 구조화된 edits(MVP는 명시적 edits 필요). |
| `strategySearch.candidates[].children` | `object[]` |  | MCTS 확장을 위한 child candidates(선택; R3). |
| `strategySearch.candidates[].options.diffMode` | `"myers" \| "semantic"` |  | dry-run 평가의 diff 모드. |
| `strategySearch.candidates[].options.includeImpact` | `boolean` |  | 후보 단위 impact 토글. |
| `strategySearch.candidates[].notes` | `string` |  | trace/debugging용 자유 형식 메모. |

**R3 MCTS 예시**

```json
{
  "strategySearch": {
    "mode": "force",
    "stage": "r3",
    "maxCandidates": 1,
    "mcts": { "maxDepth": 2, "maxRollouts": 5, "exploration": 1.4, "seed": 7 },
    "candidates": [
      {
        "id": "root",
        "intent": "Apply root strategy",
        "edits": [{ "targetString": "ROOT", "replacementString": "ROOT1" }],
        "children": [
          { "id": "leaf_a", "edits": [{ "targetString": "A", "replacementString": "A1" }] },
          { "id": "leaf_b", "edits": [{ "targetString": "B", "replacementString": "B1" }] }
        ]
      }
    ]
  }
}
```

**R3 트리 가이드**

- 각 노드는 완전하고 실행 가능한 후보여야 합니다(모든 노드에 `edits` 필요).
- 루트 노드는 서로 다른 전략을 나타내며, children은 refinement 입니다(더 작은 diff, 더 적은 파일, guard 추가 등).
- 기본 `mcts`는 `{ maxDepth: 2, maxRollouts: 5, exploration: 1.4 }`입니다.
- 예측 가능한 timebox를 위해 depth ≤2, branching ≤3을 유지하세요. 더 깊이가 필요하면 `maxRollouts`를 늘리세요.
- `targetFiles`로 blast radius를 제한하고, `notes`로 근거를 기록하세요.

**StrategySearch 출력(`change`)**

`strategySearch`가 실행되면 응답은 다음을 포함합니다:

- `strategySearch.mode`, `strategySearch.stage`
- `strategySearch.selectedCandidateId`
- `strategySearch.selectedRewardBreakdown` (선택된 후보의 reward breakdown)
- `strategySearch.degradedReasons[]`
- `strategySearch.search` (R3 전용: `{ algorithm, rollouts, maxDepth, exploration, seed?, evaluatedCount }`)
- `strategySearch.candidates[]`:
  - `id`, `label`, `dryRunOk`, `reward`, `riskLevel?`
  - `touchedFiles`, `diffSize`, `estimatedTokens`
  - `breakingChanges`
  - `contractBreaking`, `contractConsumers`, `guardsHigh`, `guardsDiagnostics`
  - `rewardBreakdown` (`base`, `penalties.*`, `signals.*`)

근거/기본값/튜닝 가이드는 `docs/adr/ADR-082-simulate-reason-execute-mcts.md`를 참고하세요.

**Workflow output**

세션(Writer's Flow)을 사용할 때 `change`는 다음도 반환합니다:

- `workflowMeta` — confidence + workflowStatus (hasResearch/hasAnalysis/hasStylePack/dryRunUsed)
- `workflowWarnings` — 누락된 flow artifacts에 대한 실행 가능한 가이드(선택; 필요할 때만 존재)

**Output (v2 / resolver path)**

`KAIRO_EDITOR_V2=true`이고 `KAIRO_EDITOR_V2_MODE`가 `off`가 아니라면, batch-shaped edits에 대해 resolver path가 사용됩니다:

- `KAIRO_EDITOR_V2_MODE=dryrun`: `{ success: true, dryRun: true, resolvedEdits: [...] }` 반환
- `KAIRO_EDITOR_V2_MODE=apply`: `{ success, dryRun, message?, changedFiles: [...] }` 반환

**ENV 설정**

- `KAIRO_EDITOR_V2=true` — v2 "Resolve → Apply" 분리 활성화(기본: `false`)
- `KAIRO_EDITOR_V2_MODE=off|dryrun|apply` — 롤아웃 단계(기본: `off`)
  - `dryrun`: 적용 없이 resolve-only 진단
  - `apply`: v2 실행 경로 전체
- `KAIRO_EDITOR_RESOLVE_TIMEOUT_MS=1500` — edit resolution 최대 시간
- `KAIRO_CHANGE_MIN_LEVENSHTEIN_TARGET_LEN=20` — 짧은 target에서 fuzzy matching 차단
- `KAIRO_CHANGE_MAX_LEVENSHTEIN_FILE_BYTES=100000` — 큰 파일에서 fuzzy matching 차단

---

### `write`

파일을 생성하거나 스캐폴딩합니다.

**파라미터**

| 필드 | 타입 | 필수 | 비고 |
|---|---|---:|---|
| `intent` | `string` | ✓ | 무엇을 생성할지. |
| `targetPath` | `string` |  | 생성 위치. 기존 draft(`draftId`)를 apply할 때 target은 draft에서 추론될 수 있습니다. 제공한다면 draft target과 일치해야 합니다. |
| `template` | `string` |  | 템플릿 이름/경로(지원 시). |
| `content` | `string` |  | 명시적 content는 생성 결과를 오버라이드합니다(레거시 문자열 전달; `contentSource` 권장). |
| `contentSource` | `object` |  | 원문 소스(ADR-089). `content`보다 우선합니다. |
| `contentBase64` | `string` |  | base64(UTF-8) 콘텐츠(Deprecated, 레거시/임시 경로; 경고 출력). |
| `fileVersions` | `object` |  | 고급 stale-guard: `{ [relPath]: { expectedVersion?, expectedHash? } }` (보통 `DraftPack.fileVersions` 또는 이전 read에서 획득). |
| `profile` | `"lean" \| "fast" \| "balanced" \| "deep"` |  | review/limits 기본값 preset. |
| `safety` | `"plan" \| "apply"` |  | dry-run 동작에 매핑(plan=true가 기본). |
| `dryRun` | `boolean` |  | DraftPack만 생성. |
| `draftId` | `string` |  | 이전 DraftPack에서 refinement 루프를 이어감. |
| `applyToken` | `string` |  | `KAIRO_MODE=mcp`에서 `safety:"apply"`에 필요(plan에서 발급). |
| `refinement` | `string` |  | 이전 draft refine에 대한 추가 가이드. |
| `draftOptions.skeletonOnly` | `boolean` |  | skeleton-only DraftPack 출력. |
| `draftOptions.includeImpact` | `boolean` |  | DraftPack에 impact 신호 포함. |
| `reviewOptions.preApply` | `boolean` |  | apply 전 리뷰 수행. |
| `reviewOptions.postApply` | `boolean` |  | apply 후 리뷰 수행. |
| `reviewOptions.strictness` | `"strict" \| "balanced" \| "permissive"` |  | 리뷰 정책. |
| `reviewOptions.blockOn` | `("syntax" \| "semantic" \| "guardrails" \| "vibe")[]` |  | 차단 기준. |
| `sessionId` | `string` |  | 플로우 세션 id(시작은 `"new"`). |
| `stylePack` | `string \| object` |  | StylePack 오버라이드(artifact id 또는 inline pack). |
| `options.safeWrite` | `boolean` |  | 트랜잭션 write 경로 사용(가능할 때 undo/rollback 지원). |
| `options.quickGenerate` | `boolean` |  | `content`가 없을 때 intent로부터 콘텐츠를 생성. |
| `options.smartWrite` | `boolean` |  | 유사 파일을 이용한 패턴 인지 생성(가능한 경우). |
| `options.styleReference` | `string[]` |  | 패턴 추출을 위한 명시적 참조 파일(선택). |
| `options.formatter` | `"auto" \| "off" \| "prettier"` |  | apply 후 formatter 실행 opt-in. |
| `trace` | `boolean` |  | v1 `effectiveOptions` + v1 `decisionTrace` 반환. |

**Notes**

- `KAIRO_MODE=mcp`에서 `safety:"apply"`는 기본적으로 server-gated입니다: plan이 `applyToken`을 반환하고, apply는 `draftId + applyToken`을 요구합니다.
- write draft를 apply할 때 draft target path 오버라이드는 안전을 위해 차단됩니다.
- write draft(`draftId`) apply 시 content는 draft snapshot에서 가져오며, apply 단계에서 `content`/`contentSource` 오버라이드는 차단됩니다(재-plan 필요).
- 따옴표/이스케이프가 민감한 텍스트(Vue 템플릿, JSON 등)는 `contentSource` 사용을 권장합니다([원문 콘텐츠 전달](/ko/guides/raw-content)).

**Workflow output**

세션(Writer's Flow)을 사용할 때 `write`도 다음을 반환합니다:

- `workflowMeta` — confidence + workflowStatus (hasResearch/hasAnalysis/hasStylePack/dryRunUsed)
- `workflowWarnings` — 누락된 flow artifacts에 대한 실행 가능한 가이드(선택; 필요할 때만 존재)

**Output (`safeWrite` 모드)**

`options.safeWrite=true`일 때:

| 필드 | 타입 | 비고 |
|---|---|---|
| `writeMode` | `"fast" \| "safe"` | 실행 경로를 나타냄. |
| `rollbackAvailable` | `boolean` | undo를 위한 operation record가 생성되면 true. |
| `transactionId` | `string` | 다른 작업과 묶였을 때의 transaction ID. |

---

### `manage`

프로젝트/세션 상태 유틸리티입니다.

- `manage({ command: "status" })`는 `rollout` 요약(preset/userIdHash/flag modes + adaptive flow gate)을 반환합니다.
- `manage({ command: "status" })`는 `symbolIndex`(semantic symbol index 상태: enabled/build time/degraded)를 반환합니다.
- `manage({ command: "status" })`는 `nativeSearch`(native search core 상태: availability/docCount 및 write-lock 신호 포함)를 반환합니다.
- `manage({ command: "status" })`는 `drift`(workspace drift 요약)를 반환합니다.
- `manage({ command: "status" })`는 `styleDrift`(StylePack provenance/confidence 요약)를 반환합니다.
- `manage({ command: "doctor" })`도 동일한 운영 진단을 담은 `rollout` 블록을 반환합니다.
- `manage({ command: "schema", tool: "task", detail: "summary" })`는 tool input schema 요약을 반환합니다. `detail:"full"`이면 schema는 artifact로 저장되고 `artifactId`가 반환됩니다( `manage({ command: "artifact" | "export", ... })`로 fetch ).
- `manage({ command: "history" })`는 최근 커밋된 트랜잭션 체크포인트 요약(`checkpoints`)을 반환합니다.
- `manage({ command: "reindex", paths: [...] })`는 특정 경로의 scoped reindex를 시도합니다(런타임 지원 시에만).
- `manage({ command: "export", targetType: "transaction", target: "<txId>" })`는 patch export를 반환합니다.
- `manage({ command: "import", target: "<path>" })`는 기본적으로 `.kairo`로 제한됩니다. 외부 경로에서 import 하려면 `allowExternal: true` 또는 `KAIRO_MANAGE_IMPORT_ALLOW_EXTERNAL=true`가 필요합니다.
- `manage({ command: "artifact", detail: "summary" | "full" })`는 그래프/증거 artifacts에 대해 summary/full view를 반환합니다.
- raw graph payload는 `manage({ command: "export", targetType: "artifact", target: "<artifactId>" })`를 사용하세요.

**파라미터**

| 필드 | 타입 | 필수 | 비고 |
|---|---|---:|---|
| `command` | `"status" \| "undo" \| "redo" \| "reindex" \| "rebuild" \| "history" \| "init" \| "doctor" \| "schema" \| "sessions" \| "session" \| "session_complete" \| "session_update" \| "artifacts" \| "artifact" \| "discard" \| "prune" \| "export" \| "import"` | ✓ | `rebuild`는 `reindex`로 매핑됩니다. |
| `scope` | `"file" \| "transaction" \| "project" \| "config" \| "languages" \| "wasm" \| "host" \| "contracts" \| "parity" \| "capabilities"` |  | `doctor`에서 사용. |
| `tool` | `string` |  | tool name(`schema`에서 사용). |
| `target` | `string` |  | 특정 대상에 동작하는 커맨드에서 사용(예: `artifact`). |
| `paths` | `string[]` |  | 증분/path-scoped refresh를 위한 `reindex`에서 사용(지원 시). |
| `targetType` | `"artifact" \| "transaction" \| "patchRef"` |  | `export` 대상 타입. |
| `allowExternal` | `boolean` |  | `.kairo` 밖에서 `import` 허용. |
| `format` | `"unified_diff" \| "structured_edits" \| "both"` |  | `export` 출력 포맷. |
| `limit` | `number` |  | list 명령(sessions)의 최대 아이템 수; graph artifact view는 node count 상한에 사용. |
| `checkpointLimit` | `number` |  | `history`가 반환하는 최대 체크포인트 수(기본 10). |
| `detail` | `"summary" \| "full"` |  | `status`/`doctor`/`schema`의 detail 레벨. |
| `limits.maxTokens` | `number` |  | `artifact` 조회의 응답 envelope 토큰 예산. |
| `limits.maxChars` | `number` |  | `artifact` 조회의 응답 envelope 문자 예산. |
| `trace` | `boolean` |  | v1 `effectiveOptions` + v1 `decisionTrace` 반환. |
| `sessionId` | `string` |  | `session` / `session_complete`의 session id. |
| `outcome` | `object` |  | `session_complete`에서 사용(예: `{ summary, status, nextSteps }`). |
| `policy` | `object` |  | `session_update`의 SessionPolicy 업데이트. |
| `policyMode` | `"merge" \| "replace"` |  | Session policy를 merge 또는 replace. |
| `artifactOptions.type` | `string` |  | type으로 artifacts 필터. |
| `artifactOptions.sessionId` | `string` |  | session으로 artifacts 필터. |
| `artifactOptions.limit` | `number` |  | 반환할 최대 artifacts. |
| `artifactOptions.includeExpired` | `boolean` |  | 만료된 artifacts 포함. |
| `mode` | `"plan" \| "apply"` |  | `init`/`doctor`/`prune`의 preview/apply. |
| `targets` | `("kairo" \| "vscode")[]` |  | `init`에서 작성할 config 종류 결정. |
| `root` | `string` |  | `init`/`doctor`의 config root 오버라이드. |
| `multiRepo` | `"auto" \| "single" \| "detect"` |  | `init`의 멀티 레포 동작. |
| `presets` | `"minimal" \| "recommended"` |  | `init`의 config preset. |
| `languageScan.maxFiles` | `number` |  | `init`이 스캔할 최대 파일 수. |
| `languageScan.sampleBytesPerFile` | `number` |  | `init`의 파일당 샘플 크기. |
| `languageScan.includeDocs` | `boolean` |  | `init` 스캔에 docs 포함. |
| `applyOptions.backup` | `boolean` |  | config 작성 시 backup 유지. |
| `applyOptions.legacyMcpConfig` | `boolean` |  | 마이그레이션 후 레거시 루트 `.mcp-config.json` 업데이트. |
| `pruneOptions` | `object` |  | 스토리지 prune 옵션(아래 참고). |

---

**Prune options (`manage` command = `prune`)**

| 필드 | 타입 | 비고 |
|---|---|---|
| `pruneOptions.targets` | `("evidence_packs" \| "chunk_summaries" \| "flow_artifacts")[]` | 기본값은 all. |
| `pruneOptions.includeExpired` | `boolean` | 만료된 엔트리 포함(기본 true). |
| `pruneOptions.includeStale` | `boolean` | stale 엔트리 포함(기본 true). |
| `pruneOptions.enforceCaps` | `boolean` | max count/bytes caps 강제(기본 true). |
| `pruneOptions.compact` | `boolean` | prune 이후 store rewrite. |
| `pruneOptions.limits.maxPacks` | `number` | 최대 evidence packs. |
| `pruneOptions.limits.maxPackBytes` | `number` | 최대 evidence pack bytes. |
| `pruneOptions.limits.maxSummaryChunks` | `number` | 최대 summary chunks. |
| `pruneOptions.limits.maxSummaryBytes` | `number` | 최대 summary bytes. |
| `pruneOptions.flowArtifacts.removeOrphans` | `boolean` | orphaned artifact 파일 제거. |

---

## Quick Tool Selector

```
무엇이 필요하신가요?
├─ 프롬프트리스/기본 UX?  → task
├─ 콘텐츠 찾기/읽기?      → task (ask/analyze) 또는 explore
├─ 구조 설명?             → task (analyze) 또는 understand
├─ 안전한 코드 변경?      → task (plan_change/apply_change) 또는 change
├─ 파일 생성?             → write (pillars surface)
└─ undo/redo/reindex 등?  → manage
```

---

## Composition Patterns

### Explore → Understand
- `explore({ query: "payments" })`
- `understand({ goal: "메인 결제 플로우를 설명해줘" })`

### Plan → Apply (with constraints)
- Plan 먼저, 그 다음 apply:
  - `change({ ..., safety: "plan" })` → `draftId` 반환(+ MCP 모드에서는 `applyToken`)
  - `change({ ..., safety: "apply", draftId, applyToken })`

### 멀티 레포 안전(기본 deny)
- `project_search`/`document_search`는 `repoScope`로 결과 범위를 좁힐 수 있습니다.
- `explore`는 `repoScope`로 discovery 결과 범위를 좁힐 수 있습니다(하위 검색 도구에 전달).
- `change`/`write`는 기본적으로 cross-repo edits를 차단하며, `allowCrossRepoEdits: true` + 레포 config `allowCrossRepoEdits: true`가 필요합니다.

### Recover
- 편집이 잘못됐다면: `manage({ command: "undo" })`
- 결과가 stale 하다면: `manage({ command: "reindex" })`

### 설정 부트스트랩
- 안전한 config 계획 생성: `manage({ command: "init", mode: "plan" })`
- config 파일 작성: `manage({ command: "init", mode: "apply" })`
- 누락/오배치 설정 진단: `manage({ command: "doctor" })`
- query packs + WASM grammar 가용성 점검: `manage({ command: "doctor", scope: "parity" })`
- provider/tier(native/wasm/js) 진단 및 tokenizer 힌트 점검: `manage({ command: "doctor", scope: "capabilities" })`
- `.kairo/contracts` 헬스 점검: `manage({ command: "doctor", scope: "contracts" })`

---

## 내부 도구(Opt-in)

`kairo`는 공개 도구 표면(compact에서는 `task` + `manage`, pillars에서는 Five Pillars)을 통해 호출되도록 설계되었습니다. 호스트가 다른 tool name을 노출하더라도, 불안정하다고 보고 사용하지 않는 것을 권장합니다.
