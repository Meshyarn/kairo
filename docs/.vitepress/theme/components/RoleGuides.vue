<script setup lang="ts">
import { computed } from "vue"
import { useData } from "vitepress"

const { lang } = useData()
const isKo = computed(() => (lang.value ?? "").toLowerCase().startsWith("ko"))

const roles = computed(() => isKo.value ? [
  {
    icon: "🏗️",
    label: "에이전트 프레임워크를 구축 중이야",
    links: [
      { text: "프레임워크 연동", url: "/ko/guides/agent-framework-integration" },
      { text: "도구 레퍼런스", url: "/ko/agent/TOOL_REFERENCE" }
    ]
  },
  {
    icon: "📐",
    label: "설계를 이해하고 싶어",
    links: [
      { text: "아키텍처 (ADR)", url: "/ko/adr/" }
    ]
  },
  {
    icon: "🚀",
    label: "프로덕션에 배포 중이야",
    links: [
      { text: "배포 시나리오", url: "/ko/guides/deployment-scenarios" },
      { text: "성능 & 신뢰성", url: "/ko/concepts/performance-and-reliability" }
    ]
  },
  {
    icon: "⚙️",
    label: "내 환경을 위해 튜닝하고 싶어",
    links: [
      { text: "초기화 & 튜닝", url: "/ko/guides/initialization-and-performance-tuning" }
    ]
  }
] : [
  {
    icon: "🏗️",
    label: "I'm building an agent framework",
    links: [
      { text: "Integration Guide", url: "/guides/agent-framework-integration" },
      { text: "Tool Reference", url: "/agent/TOOL_REFERENCE" }
    ]
  },
  {
    icon: "📐",
    label: "I need to understand the design",
    links: [
      { text: "Architecture (ADRs)", url: "/adr/" }
    ]
  },
  {
    icon: "🚀",
    label: "I'm deploying to production",
    links: [
      { text: "Deployment Scenarios", url: "/guides/deployment-scenarios" },
      { text: "Perf & Reliability", url: "/concepts/performance-and-reliability" }
    ]
  },
  {
    icon: "⚙️",
    label: "I want to tune for my environment",
    links: [
      { text: "Init & Tuning", url: "/guides/initialization-and-performance-tuning" }
    ]
  }
])
</script>

<template>
  <div class="role-grid">
    <div v-for="(role, i) in roles" :key="i" class="role-card">
      <div class="role-icon">{{ role.icon }}</div>
      <div class="role-content">
        <div class="role-label">{{ role.label }}</div>
        <div class="role-links">
          <a v-for="(link, j) in role.links" :key="j" :href="link.url" class="role-link">
            {{ link.text }} →
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
  margin: 2rem 0;
}

.role-card {
  display: flex;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}

.role-icon {
  font-size: 1.5rem;
}

.role-label {
  font-weight: 600;
  margin-bottom: 0.75rem;
  color: var(--vp-c-text-1);
}

.role-links {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.role-link {
  font-size: 0.9rem;
  color: var(--vp-c-brand) !important;
  text-decoration: none !important;
  font-weight: 500;
}

.role-link:hover {
  text-decoration: underline !important;
}
</style>