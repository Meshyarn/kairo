import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/kairo/",
  lastUpdated: true,
  head: [["link", { rel: "icon", href: "/kairo/logo.svg" }]],
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      title: "Kairo",
      description:
        "Promptless MCP server for AI agents: compact tool surface, evidence packs, safe change/write gating, offline-first baseline.",
      themeConfig: {
        logo: '/logo.svg',
        nav: [
          { text: "Overview", link: "/introduce" },
          { text: "Quickstart", link: "/quickstart/" },
          { text: "Concepts", link: "/concepts/" },
          { text: "Performance", link: "/performance/" },
          { text: "Integrations", link: "/integrations/" },
          { text: "Guides", link: "/guides/" },
          { text: "Reference", link: "/reference/" },
          { text: "ADRs", link: "/adr/" },
        ],
        sidebar: {
           "/concepts/": [
              {
                text: "Concepts",
                items: [
                  { text: "Overview", link: "/concepts/" },
                  { text: "Public Surfaces", link: "/concepts/public-surface" },
                  { text: "Evidence Packs", link: "/concepts/evidence-packs" },
                  { text: "Sessions", link: "/concepts/sessions" },
                  { text: "Safe Writes", link: "/concepts/safe-writes" },
                  { text: "Offline Baseline", link: "/concepts/offline-baseline" },
                  { text: "Performance & Reliability", link: "/concepts/performance-and-reliability" },
                ],
              },
            ],
           "/performance/": [
              {
                text: "Performance",
                items: [
                  { text: "Overview", link: "/performance/" },
                  { text: "Benchmark Report", link: "/performance/benchmarks" },
                ],
              },
            ],
           "/quickstart/": [
            {
              text: "Quickstart",
              items: [
                { text: "Overview", link: "/quickstart/" },
                { text: "Install Kairo + Configure MCP", link: "/quickstart/npm-install-and-setup" },
                { text: "Pick your defaults", link: "/quickstart/pick-your-defaults" },
                { text: "First calls", link: "/quickstart/first-calls" },
                { text: "Enable safe writes", link: "/quickstart/enable-writes" },
              ],
            },
          ],
          "/integrations/": [
            {
              text: "Integrations",
              items: [
                { text: "Overview", link: "/integrations/" },
                { text: "Agent frameworks", link: "/integrations/agent-frameworks" },
                { text: "MCP hosts (stdio)", link: "/integrations/mcp-hosts" },
                { text: "VS Code", link: "/integrations/vscode" },
              ],
            },
          ],
          "/reference/configuration/": [
            {
              text: "Configuration",
              items: [
                { text: "Overview", link: "/reference/configuration/" },
                { text: "Basics", link: "/reference/configuration/basics" },
                { text: "Project config files", link: "/reference/configuration/project-files" },
                { text: "Logging & telemetry", link: "/reference/configuration/logging-and-telemetry" },
                { text: "Search & embeddings", link: "/reference/configuration/search-and-embeddings" },
                { text: "Performance & indexing", link: "/reference/configuration/performance" },
                { text: "Documents & parsers", link: "/reference/configuration/documents-and-parsers" },
                { text: "Token budgets", link: "/reference/configuration/budgets" },
                { text: "Change/write & drift", link: "/reference/configuration/change-write-and-drift" },
                { text: "Storage & pruning", link: "/reference/configuration/storage" },
                { text: "Rollouts & experiments", link: "/reference/configuration/rollouts" },
                { text: "Advanced tuning", link: "/reference/configuration/advanced" },
                { text: "All env vars (legacy)", link: "/guides/configuration" },
              ],
            },
          ],
          "/reference/": [
            {
              text: "Reference",
              items: [
                { text: "Overview", link: "/reference/" },
                { text: "Tools", link: "/reference/tools" },
                { text: "Configuration", link: "/reference/configuration/" },
                { text: "Ops", link: "/ops/" },
              ],
            },
            {
              text: "Agent",
              items: [
                { text: "Overview", link: "/agent/" },
                { text: "Quick Reference", link: "/agent/quick-reference" },
                { text: "Tool Reference", link: "/agent/TOOL_REFERENCE" },
                { text: "Agent Playbook", link: "/agent/AGENT_PLAYBOOK" },
              ],
            },
          ],
          "/ops/": [
            {
              text: "Ops",
              items: [
                { text: "Overview", link: "/ops/" },
                { text: "Ops Runbook", link: "/guides/ops-runbook" },
                { text: "Logging & telemetry", link: "/reference/configuration/logging-and-telemetry" },
              ],
            },
          ],
           "/guides/": [
             {
               text: "Guides",
               items: [
                 { text: "Overview", link: "/guides/" },
                 { text: "Getting Started", link: "/guides/getting-started" },
                 { text: "Initialization & Performance Tuning", link: "/guides/initialization-and-performance-tuning" },
                 { text: "Deployment Scenarios", link: "/guides/deployment-scenarios" },
                 { text: "Agent Framework Integration", link: "/guides/agent-framework-integration" },
                 { text: "Promptless Integration", link: "/guides/promptless-integration" },
                 { text: "Raw Content Sources (write/change)", link: "/guides/raw-content" },
                 { text: "Search & Embeddings", link: "/guides/search-and-embeddings" },
                 { text: "Configuration (All env vars)", link: "/guides/configuration" },
                 { text: "Ops Runbook", link: "/guides/ops-runbook" },
                 { text: "Language Support", link: "/guides/language-support" },
               ],
             },
           ],
          "/agent/": [
            {
              text: "Agent",
              items: [
                { text: "Overview", link: "/agent/" },
                { text: "Quick Reference", link: "/agent/quick-reference" },
                { text: "Tool Reference", link: "/agent/TOOL_REFERENCE" },
                { text: "Agent Playbook", link: "/agent/AGENT_PLAYBOOK" },
              ],
            },
          ],
          "/adr/": [
            {
              text: "Architecture (ADRs)",
              items: [
                { text: "Overview", link: "/adr/" },
                { text: "ADR Index (Curated)", link: "/adr/README" },
              ],
            },
            {
              text: "Key ADRs",
              items: [
                { text: "ADR-040 Five Pillars Toolset", link: "/adr/ADR-040-five-pillars-toolset" },
                {
                  text: "ADR-084 MCP Autopilot & Preset Layer",
                  link: "/adr/ADR-084-mcp-autopilot-and-preset-layer",
                },
                {
                  text: "ADR-085 Rust Native Search Core (Tantivy)",
                  link: "/adr/ADR-085-rust-native-search-core-tantivy",
                },
                {
                  text: "ADR-086 Task Compact Change/Write/Verify",
                  link: "/adr/ADR-086-task-compact-change-write-verify",
                },
                {
                  text: "ADR-087 Adaptive LOD & Evidence Packs",
                  link: "/adr/ADR-087-task-adaptive-lod-and-evidence-pack",
                },
                {
                  text: "ADR-088 Agent Trust Verification Program",
                  link: "/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program",
                },
                {
                  text: "ADR-089 Raw Content Sources (change/write)",
                  link: "/adr/ADR-089-raw-content-sources-for-change-write",
                },
              ],
            },
          ],
        },
        search: {
          provider: "local",
        },
        outline: {
          level: [2, 3],
        },
      },
    },
    ko: {
      label: "한국어",
      lang: "ko-KR",
      title: "Kairo",
      description: "에이전트 프레임워크를 위한 프롬프트리스 MCP 서버: compact tool surface, evidence packs, 안전한 변경/쓰기 게이팅, 오프라인 우선.",
      themeConfig: {
        logo: '/logo.svg',
        nav: [
          { text: "개요", link: "/ko/introduce" },
          { text: "빠른 시작", link: "/ko/quickstart/" },
          { text: "개념", link: "/ko/concepts/" },
          { text: "성능", link: "/ko/performance/" },
          { text: "연동", link: "/ko/integrations/" },
          { text: "가이드", link: "/ko/guides/" },
          { text: "레퍼런스", link: "/ko/reference/" },
          { text: "ADR", link: "/ko/adr/" },
        ],
        sidebar: {
           "/ko/concepts/": [
              {
                text: "개념(Concepts)",
                items: [
                  { text: "개요", link: "/ko/concepts/" },
                  { text: "공개 표면", link: "/ko/concepts/public-surface" },
                  { text: "증거 팩", link: "/ko/concepts/evidence-packs" },
                  { text: "세션", link: "/ko/concepts/sessions" },
                  { text: "안전한 쓰기", link: "/ko/concepts/safe-writes" },
                  { text: "오프라인 베이스라인", link: "/ko/concepts/offline-baseline" },
                  { text: "성능 & 신뢰성", link: "/ko/concepts/performance-and-reliability" },
                ],
              },
            ],
           "/ko/performance/": [
              {
                text: "성능",
                items: [
                  { text: "개요", link: "/ko/performance/" },
                  { text: "벤치마크 리포트", link: "/ko/performance/benchmarks" },
                ],
              },
            ],
           "/ko/quickstart/": [
            {
              text: "빠른 시작(Quickstart)",
              items: [
                { text: "개요", link: "/ko/quickstart/" },
                { text: "Kairo 설치 + MCP 설정", link: "/ko/quickstart/npm-install-and-setup" },
                { text: "기본값 고르기", link: "/ko/quickstart/pick-your-defaults" },
                { text: "첫 호출", link: "/ko/quickstart/first-calls" },
                { text: "안전한 쓰기 활성화", link: "/ko/quickstart/enable-writes" },
              ],
            },
          ],
          "/ko/integrations/": [
            {
              text: "연동(Integrations)",
              items: [
                { text: "개요", link: "/ko/integrations/" },
                { text: "프레임워크 패턴", link: "/ko/integrations/agent-frameworks" },
                { text: "호스트 체크리스트", link: "/ko/integrations/mcp-hosts" },
                { text: "VS Code", link: "/ko/integrations/vscode" },
              ],
            },
          ],
          "/ko/reference/configuration/": [
            {
              text: "설정(Configuration)",
              items: [
                { text: "개요", link: "/ko/reference/configuration/" },
                { text: "기본(Basics)", link: "/ko/reference/configuration/basics" },
                { text: "프로젝트 설정 파일", link: "/ko/reference/configuration/project-files" },
                { text: "로깅 & 텔레메트리", link: "/ko/reference/configuration/logging-and-telemetry" },
                { text: "검색 & 임베딩", link: "/ko/reference/configuration/search-and-embeddings" },
                { text: "성능 & 인덱싱", link: "/ko/reference/configuration/performance" },
                { text: "문서 & 파서", link: "/ko/reference/configuration/documents-and-parsers" },
                { text: "토큰 예산", link: "/ko/reference/configuration/budgets" },
                { text: "change/write & drift", link: "/ko/reference/configuration/change-write-and-drift" },
                { text: "스토리지 & prune", link: "/ko/reference/configuration/storage" },
                { text: "롤아웃 & 실험", link: "/ko/reference/configuration/rollouts" },
                { text: "고급 튜닝", link: "/ko/reference/configuration/advanced" },
                { text: "전체 환경 변수(레거시)", link: "/ko/guides/configuration" },
              ],
            },
          ],
          "/ko/reference/": [
            {
              text: "레퍼런스(Reference)",
              items: [
                { text: "개요", link: "/ko/reference/" },
                { text: "도구 계약", link: "/ko/reference/tools" },
                { text: "설정", link: "/ko/reference/configuration/" },
                { text: "운영", link: "/ko/ops/" },
              ],
            },
            {
              text: "에이전트",
              items: [
                { text: "개요", link: "/ko/agent/" },
                { text: "빠른 참고서", link: "/ko/agent/quick-reference" },
                { text: "도구 레퍼런스", link: "/ko/agent/TOOL_REFERENCE" },
                { text: "플레이북", link: "/ko/agent/AGENT_PLAYBOOK" },
              ],
            },
          ],
          "/ko/ops/": [
            {
              text: "운영(Ops)",
              items: [
                { text: "개요", link: "/ko/ops/" },
                { text: "운영 런북", link: "/ko/guides/ops-runbook" },
                { text: "로깅 & 텔레메트리", link: "/ko/reference/configuration/logging-and-telemetry" },
              ],
            },
          ],
           "/ko/guides/": [
             {
               text: "가이드",
               items: [
                 { text: "개요", link: "/ko/guides/" },
                 { text: "시작하기", link: "/ko/guides/getting-started" },
                 { text: "초기화 & 성능 튜닝", link: "/ko/guides/initialization-and-performance-tuning" },
                 { text: "배포 시나리오", link: "/ko/guides/deployment-scenarios" },
                 { text: "에이전트 프레임워크 연동", link: "/ko/guides/agent-framework-integration" },
                 { text: "프롬프트리스 MCP 연동", link: "/ko/guides/promptless-integration" },
                 { text: "원문 콘텐츠 전달(write/change)", link: "/ko/guides/raw-content" },
                 { text: "검색 & 임베딩", link: "/ko/guides/search-and-embeddings" },
                 { text: "설정(전체 환경 변수)", link: "/ko/guides/configuration" },
                 { text: "운영 런북", link: "/ko/guides/ops-runbook" },
                 { text: "언어 지원", link: "/ko/guides/language-support" },
               ],
             },
           ],
          "/ko/agent/": [
            {
              text: "에이전트",
              items: [
                { text: "개요", link: "/ko/agent/" },
                { text: "빠른 참고서", link: "/ko/agent/quick-reference" },
                { text: "도구 레퍼런스", link: "/ko/agent/TOOL_REFERENCE" },
                { text: "플레이북", link: "/ko/agent/AGENT_PLAYBOOK" },
              ],
            },
          ],
          "/ko/adr/": [
            {
              text: "아키텍처 (ADR)",
              items: [
                { text: "개요", link: "/ko/adr/" },
                { text: "ADR 인덱스", link: "/ko/adr/README" },
              ],
            },
            {
              text: "핵심 ADR(영문)",
              items: [
                { text: "ADR-084 MCP Autopilot & Preset Layer", link: "/adr/ADR-084-mcp-autopilot-and-preset-layer" },
                { text: "ADR-086 Task Compact Change/Write/Verify", link: "/adr/ADR-086-task-compact-change-write-verify" },
                { text: "ADR-088 Agent Trust Verification Program", link: "/adr/ADR-088-agent-trust-e2e-verification-and-optimization-program" },
                { text: "ADR-089 Raw Content Sources (change/write)", link: "/adr/ADR-089-raw-content-sources-for-change-write" },
              ],
            },
          ],
        },
        search: {
          provider: "local",
        },
        outline: {
          level: [2, 3],
        },
      },
    },
  },
});
