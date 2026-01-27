<script setup lang="ts">
import { computed } from "vue"
import { useData } from "vitepress"

const { lang } = useData()
const isKo = computed(() => (lang.value ?? "").toLowerCase().startsWith("ko"))

const content = computed(() => isKo.value ? {
  standard: {
    title: "일반적인 접근",
    steps: [
      { actor: "에이전트", action: "인증 코드 모두 보여줘", type: "request" },
      { actor: "도구", action: "500KB 컨텍스트 반환", type: "response", bad: true },
      { actor: "에이전트", action: "2% 사용, 98% 낭비", type: "process", bad: true },
      { actor: "결과", action: "토큰 낭비, 환각, 재시도", type: "result", bad: true }
    ]
  },
  kairo: {
    title: "Kairo의 접근",
    steps: [
      { actor: "에이전트", action: "사용자 로그인 처리하는 곳은?", type: "request" },
      { actor: "Kairo", action: "3개 핵심 파일, 집중 스니펫, 증거", type: "response", good: true },
      { actor: "에이전트", action: "정확히 필요한 것을 가짐", type: "process", good: true },
      { actor: "결과", action: "정확한 추론, 첫 시도 성공", type: "result", good: true }
    ]
  }
} : {
  standard: {
    title: "Standard Approach",
    steps: [
      { actor: "Agent", action: "Show me all authentication code", type: "request" },
      { actor: "Tool", action: "Returns 500KB of context", type: "response", bad: true },
      { actor: "Agent", action: "Uses 2%, wastes 98%", type: "process", bad: true },
      { actor: "Result", action: "Wasted tokens, hallucinations, retries", type: "result", bad: true }
    ]
  },
  kairo: {
    title: "Kairo's Approach",
    steps: [
      { actor: "Agent", action: "What handles user login?", type: "request" },
      { actor: "Kairo", action: "3 key files, focused snippets, evidence", type: "response", good: true },
      { actor: "Agent", action: "Has exactly what it needs", type: "process", good: true },
      { actor: "Result", action: "Accurate reasoning, first try", type: "result", good: true }
    ]
  }
})
</script>

<template>
  <div class="comparison-container">
    <div class="card standard">
      <div class="card-header">
        <div class="icon-wrapper">⚠️</div>
        <h3>{{ content.standard.title }}</h3>
      </div>
      <div class="steps">
        <div v-for="(step, i) in content.standard.steps" :key="i" class="step">
          <div class="step-connector" v-if="i > 0">↓</div>
          <div class="step-content" :class="{ 'bad': step.bad }">
            <span class="actor">{{ step.actor }}</span>
            <span class="action">{{ step.action }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="vs-badge">VS</div>

    <div class="card kairo">
      <div class="card-header">
        <div class="icon-wrapper">✨</div>
        <h3>{{ content.kairo.title }}</h3>
      </div>
      <div class="steps">
        <div v-for="(step, i) in content.kairo.steps" :key="i" class="step">
          <div class="step-connector" v-if="i > 0">↓</div>
          <div class="step-content" :class="{ 'good': step.good }">
            <span class="actor">{{ step.actor }}</span>
            <span class="action">{{ step.action }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comparison-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  margin: 3rem 0;
  position: relative;
}

@media (max-width: 768px) {
  .comparison-container {
    grid-template-columns: 1fr;
    gap: 3rem;
  }
}

.card {
  background: var(--vp-c-bg-soft);
  border-radius: 16px;
  padding: 1.5rem;
  border: 1px solid var(--vp-c-divider);
  transition: transform 0.2s;
}

.card:hover {
  transform: translateY(-2px);
}

.card.kairo {
  border-color: var(--vp-c-brand);
  background: linear-gradient(to bottom right, var(--vp-c-bg-soft), rgba(16, 185, 129, 0.05));
}

.card-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--vp-c-divider);
}

.card-header h3 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
}

.icon-wrapper {
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: var(--vp-c-bg);
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.vs-badge {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: var(--vp-c-brand);
  color: white;
  font-weight: bold;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  z-index: 2;
  font-size: 0.9rem;
}

@media (max-width: 768px) {
  .vs-badge {
    top: auto;
    bottom: calc(50% - 1.5rem);
  }
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.step-connector {
  text-align: center;
  color: var(--vp-c-text-3);
  font-size: 1.2rem;
  line-height: 1;
  opacity: 0.5;
}

.step-content {
  background: var(--vp-c-bg);
  padding: 1rem;
  border-radius: 8px;
  border-left: 3px solid var(--vp-c-text-3);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.step-content.bad {
  border-left-color: var(--vp-c-danger);
  background: rgba(239, 68, 68, 0.05);
}

.step-content.good {
  border-left-color: var(--vp-c-brand);
  background: rgba(16, 185, 129, 0.05);
}

.actor {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-2);
  font-weight: 600;
}

.action {
  font-size: 0.95rem;
  color: var(--vp-c-text-1);
  font-weight: 500;
}
</style>