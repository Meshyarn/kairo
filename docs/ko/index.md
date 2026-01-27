---
layout: home
title: Kairo
titleTemplate: false
hero:
  name: "Kairo"
  text: "자율 에이전트를 위한 정밀 컨텍스트"
  tagline: "불필요한 데이터로 에이전트를 혼란스럽게 하지 마세요. Kairo는 방대한 파일 덤프 대신, 외과수술처럼 정교한 증거와 안전한 실행 계약을 제공합니다."
  image:
    src: /logo.svg
    alt: Kairo
  actions:
    - theme: brand
      text: "5분 안에 시작"
      link: /ko/quickstart/
    - theme: alt
      text: "개념 보기"
      link: /ko/concepts/

features:
  - icon: ⚡️
    title: "정확한 초점"
    details: "에이전트가 필요한 것만 정확히 받습니다. 같은 결과에 40-60% 적은 토큰."
    
  - icon: 🔍
    title: "증거 중심"
    details: "모든 답변에 검증 데이터 포함. 인라인 인용 + 심층 아티팩트로 완벽한 감사."
    
  - icon: 🔒
    title: "계약으로 보호"
    details: "계획 → 검토 → 적용. 드리프트 감지로 실수 방지. 절대 자동 적용 없음."
    
  - icon: ✈️
    title: "오프라인 준비됨"
    details: "로컬에서 실행. 외부 API 없음. Git 없이도 작동. 에어갭 환경 완벽."
    
  - icon: 🎯
    title: "두 가지 도구"
    details: "task (찾기/분석/편집) + manage (실행취소/다시실행/상태). 최소한, 예측 가능한 API."
    
  - icon: 🚀
    title: "프레임워크 무관"
    details: "Claude, GPT, 오픈 모델, 커스텀 에이전트. 모든 MCP 호스트, 모든 아키텍처."
---

<script setup>
import TerminalHero from '../.vitepress/theme/components/TerminalHero.vue'
import BenchmarkComparison from '../.vitepress/theme/components/BenchmarkComparison.vue'
</script>

<div style="margin: 0 auto; max-width: 1152px; padding: 0 24px;">

## 왜 Kairo인가?

<TerminalHero />

### 실제 문제

에이전트가 코드베이스를 쿼리할 때 근본적인 비효율에 직면합니다:

<ComparisonCards />

**이것이 기본입니다.** 정확성은 타협하는 것이 아니라—에이전트가 좋은 추론을 하는 데 정확히 필요한 것을 제공하는 것입니다.

---

## Kairo 작동 방식

<FeatureGrid />

---

## 실제 벤치마크 결과

<BenchmarkComparison />

---

## 주요 성과 지표

<ImpactStats />

---

## 누가 Kairo를 사용하나요?

<UserSegments />

---

## 시작하기

**최소 설정 (3줄 설정):**

```json
{
  "command": "node",
  "args": ["/path/to/kairo/dist/index.js", "--root", "/path/to/repo"],
  "timeout": 300000,
  "env": {
    "KAIRO_MODE": "mcp",
    "KAIRO_PUBLIC_SURFACE": "compact",
    "KAIRO_LOG_TO_FILE": "true"
  }
}
```

**그다음:**

<ReadingPath />

---

## 역할별 가이드

<RoleGuides />

---

</div>
