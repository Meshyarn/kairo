<script setup lang="ts">
import { computed } from "vue"
import { useData } from "vitepress"

const { lang } = useData()
const isKo = computed(() => (lang.value ?? "").toLowerCase().startsWith("ko"))

const segments = computed(() => isKo.value ? [
  {
    role: "에이전트 프레임워크 개발자",
    benefit: "환각은 줄이고 성공률은 높이는 안정적인 도구 계약을 제공합니다."
  },
  {
    role: "MCP 통합자 (Integrators)",
    benefit: "최소한의 설정으로 모든 호스트 간의 호환성을 극대화합니다."
  },
  {
    role: "엔터프라이즈 팀",
    benefit: "오프라인 환경 지원, 안전 게이트, 민감한 코드에 대한 감사(Audit) 기능을 제공합니다."
  },
  {
    role: "토큰 효율성 중시 사용자",
    benefit: "토큰/시간 트레이드오프를 감수하더라도, 라우팅으로 실지출($)을 줄이는 전략이 가능합니다."
  }
] : [
  {
    role: "Agent Framework Builders",
    benefit: "Stable tool contracts that reduce hallucinations and increase success rates."
  },
  {
    role: "MCP Integrators",
    benefit: "Minimal configuration, maximum compatibility across hosts."
  },
  {
    role: "Enterprise Teams",
    benefit: "Offline capability, safety gates, auditability for sensitive code."
  },
  {
    role: "Token-Conscious Users",
    benefit: "Routing can reduce measured spend ($), even when tokens/time trade off."
  }
])
</script>

<template>
  <div class="segments-grid">
    <div v-for="(seg, i) in segments" :key="i" class="segment-card">
      <div class="role">{{ seg.role }}</div>
      <div class="benefit">{{ seg.benefit }}</div>
    </div>
  </div>
</template>

<style scoped>
.segments-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin: 2rem 0;
}

.segment-card {
  padding: 1.5rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  border-left: 4px solid var(--vp-c-brand);
}

.role {
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--vp-c-text-1);
  margin-bottom: 0.5rem;
}

.benefit {
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}
</style>
