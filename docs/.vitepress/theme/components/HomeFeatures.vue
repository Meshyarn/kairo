<script setup>
import { useData } from "vitepress"
const { lang } = useData()

const featuresEn = [
  { title: "Compact Surface", desc: "Minimal toolset designed for generic MCP hosts. Low token overhead.", icon: "⚡️", class: "span-2" },
  { title: "Trustable Writes", desc: "Two-phase plan → apply handshake with drift verification.", icon: "🔒", class: "" },
  { title: "Evidence First", desc: "Inline citations + fetchable packs. Prove every decision.", icon: "fyp", class: "" },
  { title: "Offline Baseline", desc: "Local models & search core. No external API dependencies.", icon: "✈️", class: "span-2" }
]

const featuresKo = [
  { title: "최적화된 도구 구성", desc: "일반적인 MCP 호스트를 위해 설계된 최소한의 도구 세트. 낮은 토큰 비용.", icon: "⚡️", class: "span-2" },
  { title: "신뢰 가능한 쓰기", desc: "변경 감지(Drift) 검증을 포함한 2단계 plan → apply 핸드셰이크.", icon: "🔒", class: "" },
  { title: "근거 중심(Evidence-First)", desc: "인라인 인용과 증거 팩 제공. 모든 결정을 투명하게 입증.", icon: "fyp", class: "" },
  { title: "오프라인 베이스라인", desc: "로컬 모델과 검색 코어 기반. 외부 API 의존성 없는 독립적 동작.", icon: "✈️", class: "span-2" }
]
</script>

<template>
  <div class="bento-container">
    <div class="bento-grid">
      <div v-for="(feat, i) in (lang === 'ko-KR' ? featuresKo : featuresEn)" :key="i" class="bento-card" :class="feat.class">
        <div class="card-glow"></div>
        <div class="card-content">
          <div class="icon">{{ feat.icon }}</div>
          <h3>{{ feat.title }}</h3>
          <p>{{ feat.desc }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bento-container { padding: 0 24px; max-width: 1152px; margin: 0 auto 96px; }
.bento-grid { display: grid; grid-template-columns: repeat(1, 1fr); gap: 24px; }
@media (min-width: 768px) { .bento-grid { grid-template-columns: repeat(3, 1fr); } .span-2 { grid-column: span 2; } }
.bento-card {
  position: relative;
  background: var(--vp-c-card-bg);
  border: 1px solid var(--vp-c-card-border);
  border-radius: 12px;
 padding: 32px; overflow: hidden; transition: transform 0.3s ease, border-color 0.3s ease; }
.bento-card:hover { transform: translateY(-2px); border-color: rgba(59, 130, 246, 0.3); }
.card-content { position: relative; z-index: 1; }
.icon { font-size: 32px; margin-bottom: 16px; background: linear-gradient(135deg, #3b82f6, #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; display: inline-block; }
h3 { font-size: 20px; font-weight: 700; margin-bottom: 8px; color: var(--vp-c-text-1); }
p { font-size: 15px; color: var(--vp-c-text-2); line-height: 1.6; }
.card-glow { position: absolute; top: 0; right: 0; width: 200px; height: 200px; background: radial-gradient(circle at top right, rgba(59, 130, 246, 0.15), transparent 70%); opacity: 0; transition: opacity 0.3s ease; }
.bento-card:hover .card-glow { opacity: 1; }
</style>
