<script setup lang="ts">
import { computed } from "vue"
import { useData } from "vitepress"

const { lang } = useData()
const isKo = computed(() => (lang.value ?? "").toLowerCase().startsWith("ko"))

const steps = computed(() => isKo.value ? [
  {
    step: "01",
    title: "의도 라우팅 (Routing)",
    desc: "자연어 요청을 분석하여 검색, 문서 참조, 혹은 코드 수정 중 최적의 전략을 자동으로 수립합니다."
  },
  {
    step: "02",
    title: "컨텍스트 증류 (Distillation)",
    desc: "단순히 파일을 읽는 것이 아니라, AST 분석을 통해 에이전트에게 필요한 핵심 정의와 연관 코드만 추출합니다."
  },
  {
    step: "03",
    title: "안전 시뮬레이션 (Simulation)",
    desc: "변경을 적용하기 전, 가상으로 코드를 수정하고 의존성 충돌이나 구조적 문제를 미리 감지합니다."
  },
  {
    step: "04",
    title: "트랜잭션 적용 (Atomic Apply)",
    desc: "검증된 변경사항을 원자적(Atomic)으로 적용합니다. 파일이 그사이 변경되었다면(Drift) 작업을 거부합니다."
  }
] : [
  {
    step: "01",
    title: "Intent Routing",
    desc: "Analyzes the request to determine the best strategy: search, read docs, or plan code changes."
  },
  {
    step: "02",
    title: "Context Distillation",
    desc: "Uses AST analysis to strip noise, extracting only the relevant definitions and dependencies needed."
  },
  {
    step: "03",
    title: "Safety Simulation",
    desc: "Simulates the change before applying. Checks for breaking changes and dependencies to generate an impact report."
  },
  {
    step: "04",
    title: "Transactional Apply",
    desc: "Executes verified changes atomically. If the file has drifted in the background, the operation is rejected."
  }
])
</script>

<template>
  <div class="workflow-container">
    <div v-for="(item, i) in steps" :key="i" class="workflow-step">
      <div class="step-header">
        <span class="step-number">{{ item.step }}</span>
        <div class="step-connector" v-if="i < steps.length - 1"></div>
      </div>
      <div class="step-content">
        <h3>{{ item.title }}</h3>
        <p>{{ item.desc }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workflow-container {
  display: flex;
  justify-content: space-between;
  gap: 1.5rem;
  margin: 3rem 0;
  position: relative;
}

@media (max-width: 960px) {
  .workflow-container {
    flex-direction: column;
    gap: 2rem;
  }
}

.workflow-step {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
}

@media (max-width: 960px) {
  .workflow-step {
    flex-direction: row;
    align-items: flex-start;
    gap: 1.5rem;
  }
}

.step-header {
  display: flex;
  align-items: center;
  margin-bottom: 1.5rem;
  position: relative;
}

.step-number {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--vp-c-brand);
  background: var(--vp-c-bg-soft);
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 2px solid var(--vp-c-brand);
  z-index: 2;
  box-shadow: 0 4px 10px rgba(0,0,0,0.1);
}

.step-connector {
  position: absolute;
  left: 50px;
  right: -24px; /* Extend to the next item */
  height: 2px;
  background: linear-gradient(90deg, var(--vp-c-brand), var(--vp-c-divider));
  z-index: 1;
  top: 50%;
  transform: translateY(-50%);
}

@media (max-width: 960px) {
  .step-header {
    margin-bottom: 0;
  }
  
  .step-connector {
    display: none; /* Hide horizontal connector on mobile */
  }

  /* Vertical line for mobile */
  .workflow-step:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 25px; /* Center of the 50px circle */
    top: 50px;
    bottom: -32px; /* Gap size + extra */
    width: 2px;
    background: var(--vp-c-divider);
    z-index: 0;
  }
}

.step-content {
  background: var(--vp-c-bg-soft);
  padding: 1.25rem;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  transition: transform 0.2s;
  height: 100%;
}

.workflow-step:hover .step-content {
  transform: translateY(-4px);
  border-color: var(--vp-c-brand-light);
}

.step-content h3 {
  margin: 0 0 0.75rem 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.step-content p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}
</style>