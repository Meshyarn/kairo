<script setup lang="ts">
import { computed } from "vue"
import { useData } from "vitepress"

const { lang } = useData()
const isKo = computed(() => (lang.value ?? "").toLowerCase().startsWith("ko"))

const steps = computed(() => isKo.value ? [
  { title: "개요", time: "5분", desc: "Kairo의 존재 이유와 사용 시점", link: "/ko/introduce" },
  { title: "빠른 시작", time: "15분", desc: "연결 및 첫 작동 호출", link: "/ko/quickstart/" },
  { title: "핵심 개념", time: "15분", desc: "증거 팩, 안전한 쓰기, 오프라인 베이스라인", link: "/ko/concepts/" },
  { title: "도구 레퍼런스", time: "20분", desc: "task와 manage 계약 심화", link: "/ko/agent/TOOL_REFERENCE" },
  { title: "가이드", time: "가변", desc: "실제 워크플로우 (운영, 튜닝)", link: "/ko/guides/" }
] : [
  { title: "Overview", time: "5 min", desc: "Why Kairo exists and when to use it", link: "/introduce" },
  { title: "Quickstart", time: "15 min", desc: "Get connected and make your first call", link: "/quickstart/" },
  { title: "Concepts", time: "15 min", desc: "Evidence Packs, Safe Writes, Offline Baseline", link: "/concepts/" },
  { title: "Tool Reference", time: "20 min", desc: "Deep dive into task and manage contracts", link: "/agent/TOOL_REFERENCE" },
  { title: "Guides", time: "Variable", desc: "Real workflows: ops, tuning", link: "/guides/" }
])
</script>

<template>
  <div class="reading-path">
    <a v-for="(step, i) in steps" :key="i" :href="step.link" class="step-card">
      <div class="step-num">{{ i + 1 }}</div>
      <div class="step-content">
        <div class="step-header">
          <span class="step-title">{{ step.title }}</span>
          <span class="step-time">{{ step.time }}</span>
        </div>
        <div class="step-desc">{{ step.desc }}</div>
      </div>
    </a>
  </div>
</template>

<style scoped>
.reading-path {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 2rem 0;
}

.step-card {
  display: flex;
  align-items: center;
  padding: 1rem;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  text-decoration: none !important;
  color: inherit !important;
  transition: transform 0.2s, border-color 0.2s;
}

.step-card:hover {
  transform: translateX(4px);
  border-color: var(--vp-c-brand);
}

.step-num {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--vp-c-text-3);
  margin-right: 1.5rem;
  width: 32px;
  text-align: center;
}

.step-content {
  flex: 1;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.step-title {
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--vp-c-text-1);
}

.step-time {
  font-size: 0.8rem;
  padding: 2px 6px;
  background: var(--vp-c-bg);
  border-radius: 4px;
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
}

.step-desc {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}
</style>