# 아키텍처 결정 기록(ADR) (큐레이션)

이 디렉터리는 `kairo`의 큐레이션된 ADR 세트를 포함합니다.

업스트림 프로젝트 히스토리에는 많은 ADR 문서가 있습니다. OSS 가독성(그리고 60개가 넘는 파일에 독자가 파묻히는 것을 피하기 위해), 우리는:

- 현재 아키텍처와 “왜 그런 선택을 했는지”를 담는 ~10–12개의 “리터치(retouched)” ADR을 유지합니다.
- 나머지 ADR은 이 인덱스에서 짧고 검색 가능한 요약 엔트리로 제공합니다.

딱 하나만 읽는다면, 여기서 시작하세요:

- `docs/adr/ADR-040-five-pillars-toolset.md` (public tool surface)
- `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md` (프롬프트리스 MCP 기본값: `task` + presets + handshake)
- `docs/adr/ADR-041-integrity-audit-and-guardrails.md` (safety 모델)
- `docs/adr/ADR-050-writers-flow.md` (워크플로우 계약; `0.2.x`에서 artifacts/session 지원)

## 리터치 ADR (OSS 기준 정본)

- `docs/adr/ADR-040-five-pillars-toolset.md`
- `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md`
- `docs/adr/ADR-041-integrity-audit-and-guardrails.md`
- `docs/adr/ADR-042-series-production-baseline.md`
- `docs/adr/ADR-043-adaptive-context-architecture.md`
- `docs/adr/ADR-044-universal-language-parity.md`
- `docs/adr/ADR-045-modular-architecture.md`
- `docs/adr/ADR-046-semantic-validation-layer.md`
- `docs/adr/ADR-047-multi-repo-multi-language.md`
- `docs/adr/ADR-036-039-universal-documents-and-evidence.md`
- `docs/adr/ADR-050-writers-flow.md`
- `docs/adr/ADR-089-raw-content-sources-for-change-write.md`

## Rejected / Deferred 결정 (중요한 컨텍스트)

ADR 히스토리를 볼 때 “선택되지 않은” 결정도 선택된 결정만큼 중요합니다. 이 레포에서는 두 가지 방식으로 기록합니다:

1. **ADR 내부**: “Non-Goals”, “Out of scope”, “Rejected alternatives”, “Deferred items” 같은 섹션
2. **이 인덱스**: “우리가 X를 고려했지만 하지 않았다”를 짧게 정리한 목록

주요 예시(큐레이션):

- **새 `audit` pillar 추가 없음(rejected)**: public tool surface 확장을 피하기 위해 integrity 체크는 기존 pillars의 mode/options로 통합합니다(`docs/adr/ADR-041-integrity-audit-and-guardrails.md`).
- **언어별 LSP/typecheck 의무화(deferred/rejected)**: semantic validation은 바람직하지만, 언어별로 무거운 의존성을 강제하는 것은 deferred; `docs/adr/ADR-046-semantic-validation-layer.md` 참고.
- **“전부 반환” read API(rejected)**: 원시 컨텍스트로 에이전트를 범람시키는 설계는 progressive disclosure로 대체되었습니다(`docs/adr/ADR-040-five-pillars-toolset.md`, `docs/adr/ADR-043-adaptive-context-architecture.md`).
- **네트워크 우선 아키텍처(rejected)**: 베이스라인은 local/offline-first 입니다. 원격 서비스는 나중에 선택적으로 추가될 수 있지만 실행에 필수는 아닙니다(`docs/adr/ADR-042-series-production-baseline.md`).

향후 새 ADR을 추가한다면 다음을 명시적으로 표시하는 것을 권장합니다:

- `Status: Accepted | Implemented | Rejected | Deferred | Superseded`
- “Rejected alternatives” (대안별 1줄 이유)
- “Revisit criteria” (deferred/rejected 옵션이 viable해지려면 무엇이 바뀌어야 하는지)

## 전체 인덱스 (모든 ADR 요약)

아래 엔트리는 프로젝트 히스토리의 모든 ADR을 커버합니다. “retouched”로 표시된 항목은 이 폴더에 전용 파일이 있으며, 나머지는 여기서 요약합니다.

### Public tool surface & workflows

- ADR-040 (retouched): Five Pillars 도구세트 통합 → `docs/adr/ADR-040-five-pillars-toolset.md`
- ADR-050 (retouched): Writer’s Flow 계약 → `docs/adr/ADR-050-writers-flow.md`
- ADR-089 (retouched): `change`/`write` 원문 소스(ContentSource) 계약(따옴표/이스케이프 깨짐 방지) → `docs/adr/ADR-089-raw-content-sources-for-change-write.md`
- ADR-051: 리뷰 품질 + 세션 UX → `docs/ko/agent/TOOL_REFERENCE.md` + `docs/ko/guides/getting-started.md` + `docs/ko/guides/configuration.md` 참고
- ADR-052: pillar 옵션 프로파일 + 세션 정책 → `docs/adr/ADR-052-pillar-option-profiles-and-session-policy.md`
- ADR-053-C: Managed config bootstrap (`manage init/doctor`) → `docs/adr/ADR-053-C-managed-config-bootstrap.md`
- ADR-054: 크로스-언어 계약 인지(boundary adapters baseline) → `docs/adr/ADR-054-cross-language-contract-awareness.md`
- ADR-054-H: 계약 hardening & bootstrap alignment(NAPI) → `docs/adr/ADR-054-H-contract-hardening-and-bootstrap.md`
- ADR-055: Universal parity & 표준화 프로그램 → `docs/adr/ADR-055-universal-parity-and-standardization.md`
- ADR-056: 토큰 인지 동적 컨텍스트 압축(maxTokens + distill) → `docs/adr/ADR-056-token-aware-dynamic-context-compression.md`
- ADR-057: unified degradedReasons + action guidance v1 → `docs/adr/ADR-057-unified-degraded-reasons-and-action-guidance-v1.md`
- ADR-058: tool schema 계약 + 호환성 레이어 → `docs/adr/ADR-058-tool-schema-contract-and-compatibility-layer.md`
- ADR-059: EvidencePack/Summaries 라이프사이클(prune/compact) → `docs/adr/ADR-059-evidence-pack-and-summaries-lifecycle-prune-compact.md`
- ADR-060: 문서 도구 패리티(PDF/XLSX) → `docs/adr/ADR-060-document-tool-parity-pdf-xlsx.md`
- ADR-062: 멀티 레포 E2E UX + safety boundaries → `docs/adr/ADR-062-multi-repo-e2e-ux-and-safety-boundaries.md`
- ADR-063: Capability Diagnostics & Provider Policy Integration → `docs/adr/ADR-063-capability-diagnostics-and-provider-policy-integration.md`
- ADR-064: FileVersion Handshake (read↔apply) → `docs/adr/ADR-064-fileversion-handshake-read-apply.md`
- ADR-065: Change Execution Contract (atomic apply + delete policy) → `docs/adr/ADR-065-change-execution-contract-atomic-apply-partial-opt-in-delete-policy.md`
- ADR-066: Guardrails override & audit trail → `docs/adr/ADR-066-guardrails-override-and-audit-trail.md`
- ADR-067: Observability baseline (bench accuracy + minimal metrics + optional OTel) → `docs/adr/ADR-067-observability-baseline-bench-accuracy-min-metrics-otel.md`
- ADR-068: Index freshness & cache invalidation program → `docs/adr/ADR-068-index-freshness-cache-invalidation-program.md`
- ADR-069: Search/index scalability without SQLite (baseline async, secondary index) → `docs/adr/ADR-069-search-index-scalability-without-sqlite.md`
- ADR-070: 오프라인 베이스라인 정책(원격 임베딩, 모델 패키징) → `docs/adr/ADR-070-offline-baseline-policy-remote-embeddings-model-packaging.md`
- ADR-071: IFileSystem boundary 확장 & testability 프로그램 → `docs/adr/ADR-071-ifilesystem-boundary-expansion-and-testability-program.md`
- ADR-072: pillar 분해 & 모듈 경계 hardening → `docs/adr/ADR-072-pillar-decomposition-and-module-boundary-hardening.md`
- ADR-073: Option trace standardization (decisionTrace/effectiveOptions v1) → `docs/adr/ADR-073-option-trace-standardization-decisiontrace-effectiveoptions.md`
- ADR-074: Token budget allocator v2 + summary reuse → `docs/adr/ADR-074-token-budget-allocator-v2-cross-pillar-summary-reuse.md`
- ADR-075: Adaptive Flow rollout plan (profile/scale gate) → `docs/adr/ADR-075-adaptive-flow-rollout-plan-ucg-lod-profile-based-enable.md`
- ADR-076: Symbol semantic search E2E (opt-in) → `docs/adr/ADR-076-symbol-semantic-search-e2e-integrate-or-deprecate.md`
- ADR-077: Mixed-workflow resilience (drift + checkpoints) → `docs/adr/ADR-077-mixed-workflow-resilience.md`
- ADR-078: Cost stabilization & adaptive LOD (Lean-first) → `docs/adr/ADR-078-cost-stabilization-and-adaptive-lod.md`
- ADR-079: Workflow UX & style reliability v2 → `docs/adr/ADR-079-workflow-ux-and-style-reliability-v2.md`
- ADR-080: Explore/Understand response envelope token budget → `docs/adr/ADR-080-response-envelope-token-budget-explore-understand.md`
- ADR-081: GraphRAG hybrid cluster retrieval → `docs/adr/ADR-081-graphrag-hybrid-cluster-retrieval.md`
- ADR-082: Simulate → Reason → Execute (StrategySearch + MCTS) → `docs/adr/ADR-082-simulate-reason-execute-mcts.md`
- ADR-083: Language-agnostic symbolic guards → `docs/adr/ADR-083-language-agnostic-symbolic-guards.md`
- ADR-084: MCP autopilot & preset layer → `docs/adr/ADR-084-mcp-autopilot-and-preset-layer.md`
- ADR-085: Rust native search core (Tantivy) → `docs/adr/ADR-085-rust-native-search-core-tantivy.md`
- ADR-086: Task Compact Change/Write/Verify → `docs/adr/ADR-086-task-compact-change-write-verify.md`
- ADR-087: Adaptive LOD + evidence packs → `docs/adr/ADR-087-task-adaptive-lod-and-evidence-pack.md`
- ADR-088: Agent trust E2E verification & optimization program → `docs/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program.md`

### Retrieval, search, and context construction

- ADR-043 (retouched): Adaptive Context Architecture (LOD + UCG) → `docs/adr/ADR-043-adaptive-context-architecture.md`
- ADR-069: Search/index scalability without SQLite → `docs/adr/ADR-069-search-index-scalability-without-sqlite.md`
- ADR-085: Rust native search core (Tantivy) → `docs/adr/ADR-085-rust-native-search-core-tantivy.md`
- ADR-017/018: Context-aware clustered search (historical).
- ADR-014: Smart File Profile (historical).

### Language support, query-driven extraction, and multi-repo

- ADR-044 (retouched): Universal language parity via Tree-sitter WASM → `docs/adr/ADR-044-universal-language-parity.md`
- ADR-047 (retouched): Multi-repo + multi-language expansion → `docs/adr/ADR-047-multi-repo-multi-language.md`
- ADR-062: Multi-repo E2E UX + safety boundaries → `docs/adr/ADR-062-multi-repo-e2e-ux-and-safety-boundaries.md`

### Documents and evidence

- ADR-036–039 (retouched): Universal documents, retrieval ops, evidence packs → `docs/adr/ADR-036-039-universal-documents-and-evidence.md`

### Early foundations (historical)

이들은 “왜 이걸 만들었는가”에 대한 오래된 문서들입니다:

- ADR-001–006: 초기 아키텍처 및 오케스트레이션.
- ADR-010–013: 시맨틱 분석 및 프로젝트 인텔리전스.
- ADR-021: 엔터프라이즈급 코어 개선.

### Meta ADRs / tracking notes

- ADR-042 completion summary: `docs/adr/ADR-042-series-production-baseline.md`로 커버.

## Complete ADR list

전체 리스트는 영문 원본(`docs/adr/README.md`)을 참고하세요.
