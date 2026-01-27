<script setup lang="ts">
import { computed } from "vue"
import { useData } from "vitepress"

const { lang } = useData()
const isKo = computed(() => (lang.value ?? "").toLowerCase().startsWith("ko"))

const stats = computed(() => isKo.value ? [
  { label: "40-60% 토큰 절감", desc: "동등한 작업 수행 시", icon: "📉" },
  { label: "15-25% 성공률 증가", desc: "재시도 없는 첫 시도", icon: "🎯" },
  { label: "100% 실수 방지", desc: "드리프트 감지 보장", icon: "🛡️" },
  { label: "외부 의존성 Zero", desc: "완전한 로컬/오프라인", icon: "✈️" }
] : [
  { label: "40-60% Less Tokens", desc: "For equivalent tasks", icon: "📉" },
  { label: "15-25% Higher Success", desc: "First-attempt rate", icon: "🎯" },
  { label: "100% Drift Detection", desc: "Prevents accidental overwrites", icon: "🛡️" },
  { label: "Zero External Deps", desc: "Works entirely locally", icon: "✈️" }
])
</script>

<template>
  <div class="impact-container">
    <div v-for="(stat, i) in stats" :key="i" class="stat-item">
      <div class="icon-circle">{{ stat.icon }}</div>
      <div class="label">{{ stat.label }}</div>
      <div class="desc">{{ stat.desc }}</div>
    </div>
  </div>
</template>

<style scoped>
.impact-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 2rem;
  margin: 3rem 0;
  text-align: center;
  padding: 3rem 2rem;
  background: var(--vp-c-bg-soft);
  border-radius: 24px;
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 4px 20px rgba(0,0,0,0.03);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
}

.icon-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--vp-c-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  margin-bottom: 1rem;
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 4px 10px rgba(0,0,0,0.05);
}

.label {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin-bottom: 0.5rem;
}

.desc {
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
  max-width: 200px;
}
</style>