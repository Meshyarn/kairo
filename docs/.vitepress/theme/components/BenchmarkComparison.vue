<script setup lang="ts">
import { computed, ref } from "vue"
import { useData } from "vitepress"

const { lang } = useData()
const isKo = computed(() => (lang.value ?? "").toLowerCase().startsWith("ko"))
const activeMetric = ref<'cost' | 'accuracy' | 'time'>('cost')

const data = computed(() => isKo.value ? {
  title: "실제 벤치마크 결과",
  subtitle: "고비용 모델 vs 라우팅 전략",
  legend: "Mini(작은모델) + Kairo 라우팅이 Full(고성능모델) 기준선을 압도",
  
  metrics: {
    cost: {
      label: "비용 효율성",
      labelSuffix: "(📉 낮을수록 좋음)",
      unit: "USD",
      goal: "lower",
      full: 2.0497,
      routed: 0.5396,
      delta: -1.5101,
      percentage: -73.7,
      highlight: true,
      icon: "💰"
    },
    accuracy: {
      label: "성공률 (Pass@1)",
      labelSuffix: "(📈 높을수록 좋음)",
      unit: "%",
      goal: "higher",
      full: 87.5,
      routed: 100,
      delta: 12.5,
      percentage: 14.3,
      highlight: true,
      icon: "🎯"
    },
    time: {
      label: "실행 시간",
      labelSuffix: "(📉 낮을수록 좋음)",
      unit: "ms",
      goal: "lower",
      full: 1042324,
      routed: 1610173,
      delta: 567849,
      percentage: 54.5,
      highlight: false,
      icon: "⏱️"
    }
  },

  systems: [
    {
      name: "Full Baseline",
      desc: "최고 성능 모델 (GPT-5 Codex)",
      badge: "기준선",
      cost: 2.0497,
      pass: 87.5,
      time: 1042,
      tokens: 4065811,
      cases: 8,
      failed: 1,
      color: "var(--vp-c-danger)"
    },
    {
      name: "Routed Strategy",
      desc: "작은 모델 + Kairo",
      badge: "권장",
      cost: 0.5396,
      pass: 100,
      time: 1610,
      tokens: 5842264,
      cases: 8,
      failed: 0,
      color: "var(--vp-c-brand)"
    }
  ],

  details: {
    title: "상세 분석",
    sections: [
      {
        heading: "성공률이 중요한 이유",
        text: "고성능 모델(GPT-5)도 8개 케이스 중 1개에서 파일 검증 단계를 실패했습니다. Kairo의 구조화된 워크플로우는 절차적 검증을 강제하므로 이러한 엣지 케이스를 완벽히 처리합니다."
      },
      {
        heading: "시간 증가는 투자, 아닌 낭비",
        text: "실행 시간이 54% 더 길지만, 이는 추가 검증과 구조적 안정성을 위한 것입니다. 사람이 한 번의 실패를 고쳐야 하는 시간(최소 10-20분)에 비하면, 자동화된 검증 몇 분은 무시할 수 있는 수준입니다."
      },
      {
        heading: "비용 절감은 구조적 필연",
        text: "작은 모델을 메인으로 사용하고 복잡한 작업에만 큰 모델을 라우팅하는 아키텍처 자체가 비용을 낮춥니다. 이는 운이 아니라 설계의 승리입니다."
      }
    ]
  },

  methodology: {
    title: "방법론",
    note: "본 벤치마크는 대표 시나리오 기준 단일 실행(single-shot) 결과입니다.",
    items: [
      "테스트 케이스: 8개 (스키마, 기능, CLI, UX, 문서)",
      "모델: GPT-5 Codex (Full) vs GPT-5 Codex (Mini)",
      "타임아웃: 600초",
      "라우팅 규칙: 복잡한 케이스(파일 5개 이상 or UX/CLI 카테고리) → Full 모델",
      "가격: 2025년 1월 기준 공식 API 가격"
    ]
  }
} : {
  title: "Real Benchmark Results",
  subtitle: "High-cost model vs Routing strategy",
  legend: "Mini model + Kairo routing dominates Full model baseline across cost and accuracy",
  
  metrics: {
    cost: {
      label: "Cost Efficiency",
      labelSuffix: "(📉 Lower is better)",
      unit: "USD",
      goal: "lower",
      full: 2.0497,
      routed: 0.5396,
      delta: -1.5101,
      percentage: -73.7,
      highlight: true,
      icon: "💰"
    },
    accuracy: {
      label: "Success Rate (Pass@1)",
      labelSuffix: "(📈 Higher is better)",
      unit: "%",
      goal: "higher",
      full: 87.5,
      routed: 100,
      delta: 12.5,
      percentage: 14.3,
      highlight: true,
      icon: "🎯"
    },
    time: {
      label: "Execution Time",
      labelSuffix: "(📉 Lower is better)",
      unit: "ms",
      goal: "lower",
      full: 1042324,
      routed: 1610173,
      delta: 567849,
      percentage: 54.5,
      highlight: false,
      icon: "⏱️"
    }
  },

  systems: [
    {
      name: "Full Baseline",
      desc: "State-of-the-art model (GPT-5 Codex)",
      badge: "Baseline",
      cost: 2.0497,
      pass: 87.5,
      time: 1042,
      tokens: 4065811,
      cases: 8,
      failed: 1,
      color: "var(--vp-c-danger)"
    },
    {
      name: "Routed Strategy",
      desc: "Mini model + Kairo",
      badge: "Recommended",
      cost: 0.5396,
      pass: 100,
      time: 1610,
      tokens: 5842264,
      cases: 8,
      failed: 0,
      color: "var(--vp-c-brand)"
    }
  ],

  details: {
    title: "Detailed Analysis",
    sections: [
      {
        heading: "Why Success Rate Matters",
        text: "Even the SOTA model (GPT-5) failed 1 out of 8 cases at the file validation step. Kairo's structured workflow enforces procedural validation, handling edge cases perfectly."
      },
      {
        heading: "Time Increase is Investment, Not Waste",
        text: "54% longer execution is the cost of additional validation and structural reliability. Compare this to the 10-20 minutes humans spend debugging a single failure—a few extra minutes of automation is negligible."
      },
      {
        heading: "Cost Reduction is Architectural",
        text: "Using a smaller model as the default and routing complex tasks to larger models isn't luck—it's architectural design. This pattern scales reliably."
      }
    ]
  },

  methodology: {
    title: "Methodology",
    note: "This benchmark represents a single-shot run on representative scenarios.",
    items: [
      "Test cases: 8 (schema, feature, CLI, UX, docs)",
      "Models: GPT-5 Codex (Full) vs GPT-5 Codex (Mini)",
      "Timeout: 600 seconds",
      "Routing rule: Complex cases (5+ files OR ux/cli category) → Full model",
      "Pricing: Official API rates as of January 2025"
    ]
  }
})

// Helper to determine winner
const isWinner = (metricKey: 'cost' | 'accuracy' | 'time', isRouted: boolean) => {
  const metric = data.value.metrics[metricKey]
  if (metricKey === 'cost') return isRouted // Lower cost (routed) wins
  if (metricKey === 'accuracy') return isRouted // Higher accuracy (routed) wins
  if (metricKey === 'time') return !isRouted // Lower time (baseline) wins
  return false
}

// Chart calculations
const getBarWidth = (value: number, max: number) => {
  return (value / max) * 100
}

// Format numbers
const formatNumber = (num: number, decimals = 2) => {
  if (num >= 1000000) return (num / 1000000).toFixed(decimals) + "M"
  if (num >= 1000) return (num / 1000).toFixed(decimals) + "K"
  return num.toFixed(decimals)
}

const formatTime = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

const formatCost = (num: number) => `$${num.toFixed(4)}`
const formatPercent = (num: number) => `${num.toFixed(1)}%`
</script>

<template>
  <div class="benchmark-container">
    <!-- Header -->
    <div class="benchmark-header">
      <h3>{{ data.title }}</h3>
      <p class="subtitle">{{ data.subtitle }}</p>
      <p class="legend">{{ data.legend }}</p>
    </div>

    <!-- Metric Selector -->
    <div class="metric-selector">
      <button
        v-for="(metric, key) in data.metrics"
        :key="key"
        :class="{ active: activeMetric === key }"
        @click="activeMetric = key as any"
      >
        <span class="icon">{{ metric.icon }}</span>
        <span class="name">{{ metric.label }}</span>
        <span class="goal-hint">{{ metric.labelSuffix }}</span>
      </button>
    </div>

    <!-- Main Comparison Card -->
    <div class="comparison-card">
      <div class="chart-section">
        <!-- Active Metric Display -->
        <div class="metric-display">
          <div class="metric-value">
            <span v-if="activeMetric === 'cost'" class="value">{{ formatCost(data.metrics.cost.routed) }}</span>
            <span v-else-if="activeMetric === 'accuracy'" class="value">{{ formatPercent(data.metrics.accuracy.routed) }}</span>
            <span v-else class="value">{{ formatTime(data.metrics.time.routed) }}</span>
          </div>
          <div 
            class="metric-delta" 
            :class="{ 
              positive: (data.metrics[activeMetric].goal === 'higher' && data.metrics[activeMetric].delta > 0) || 
                       (data.metrics[activeMetric].goal === 'lower' && data.metrics[activeMetric].delta < 0),
              negative: (data.metrics[activeMetric].goal === 'higher' && data.metrics[activeMetric].delta < 0) || 
                       (data.metrics[activeMetric].goal === 'lower' && data.metrics[activeMetric].delta > 0)
            }"
          >
            <span v-if="data.metrics[activeMetric].delta > 0">↑</span>
            <span v-else>↓</span>
            {{ Math.abs(data.metrics[activeMetric].percentage) }}%
          </div>
        </div>

        <!-- Horizontal Bar Chart -->
        <div class="bar-chart">
          <!-- Full Baseline Bar -->
          <div class="bar-item">
            <div class="bar-header">
              <span class="bar-label">Full Baseline</span>
              <span v-if="isWinner(activeMetric, false)" class="winner-badge">🏆 Winner</span>
            </div>
            <div class="bar-wrapper">
              <div
                class="bar baseline"
                :style="{
                  width: activeMetric === 'cost' ? '100%' : activeMetric === 'accuracy' ? '87.5%' : '64.7%'
                }"
              >
                <span class="bar-value">
                  <span v-if="activeMetric === 'cost'">{{ formatCost(data.metrics.cost.full) }}</span>
                  <span v-else-if="activeMetric === 'accuracy'">{{ formatPercent(data.metrics.accuracy.full) }}</span>
                  <span v-else>{{ formatTime(data.metrics.time.full) }}</span>
                </span>
              </div>
            </div>
          </div>

          <!-- Routed Strategy Bar -->
          <div class="bar-item">
            <div class="bar-header">
              <span class="bar-label">Routed Strategy</span>
              <span v-if="isWinner(activeMetric, true)" class="winner-badge">🏆 Winner</span>
            </div>
            <div class="bar-wrapper">
              <div
                class="bar routed"
                :style="{
                  width: activeMetric === 'cost' ? '26.3%' : activeMetric === 'accuracy' ? '100%' : '100%'
                }"
              >
                <span class="bar-value">
                  <span v-if="activeMetric === 'cost'">{{ formatCost(data.metrics.cost.routed) }}</span>
                  <span v-else-if="activeMetric === 'accuracy'">{{ formatPercent(data.metrics.accuracy.routed) }}</span>
                  <span v-else>{{ formatTime(data.metrics.time.routed) }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Details Grid -->
      <div class="details-grid">
        <div v-for="(system, idx) in data.systems" :key="idx" class="system-card">
          <div class="card-header" :style="{ borderColor: system.color }">
            <h4>{{ system.name }}</h4>
            <span class="badge" :style="{ background: system.color }">{{ system.badge }}</span>
          </div>
          <p class="card-desc">{{ system.desc }}</p>
          
          <div class="metrics-grid">
            <div class="metric">
              <span class="label">Cost</span>
              <span class="value">{{ formatCost(system.cost) }}</span>
            </div>
            <div class="metric">
              <span class="label">Success</span>
              <span class="value">{{ formatPercent(system.pass) }}</span>
            </div>
            <div class="metric">
              <span class="label">Time</span>
              <span class="value">{{ formatTime(system.time * 1000) }}</span>
            </div>
            <div class="metric">
              <span class="label">Total Tokens</span>
              <span class="value">{{ formatNumber(system.tokens) }}</span>
            </div>
          </div>

          <div class="test-summary">
            <span v-if="system.failed === 0" class="passed">✅ All {{ system.cases }} tests passed</span>
            <span v-else class="failed">❌ {{ system.failed }}/{{ system.cases }} failed</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Key Insights -->
    <div class="insights-section">
      <h4>{{ data.details.title }}</h4>
      <div class="insights-grid">
        <div v-for="(insight, idx) in data.details.sections" :key="idx" class="insight-card">
          <h5>{{ insight.heading }}</h5>
          <p>{{ insight.text }}</p>
        </div>
      </div>
    </div>

    <!-- Methodology -->
    <div class="methodology-section">
      <h4>{{ data.methodology.title }}</h4>
      <div class="methodology-note">
        <strong>📋 {{ data.methodology.note }}</strong>
      </div>
      <ul class="methodology-items">
        <li v-for="(item, idx) in data.methodology.items" :key="idx">{{ item }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.benchmark-container {
  margin: 3rem 0;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.benchmark-header {
  text-align: center;
  margin-bottom: 1rem;
}

.benchmark-header h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.5rem;
  color: var(--vp-c-text-1);
}

.subtitle {
  margin: 0 0 0.5rem 0;
  font-size: 1.1rem;
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.legend {
  margin: 0;
  font-size: 0.95rem;
  color: var(--vp-c-text-3);
  font-style: italic;
}

/* Metric Selector */
.metric-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  margin: 1rem 0;
}

.metric-selector button {
  background: var(--vp-c-bg-soft);
  border: 2px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  font-family: inherit;
  position: relative;
  overflow: hidden;
}

.metric-selector button:hover {
  border-color: var(--vp-c-brand);
  background: var(--vp-c-bg);
}

.metric-selector button.active {
  background: var(--vp-c-brand);
  border-color: var(--vp-c-brand);
  color: white;
}

.metric-selector .icon {
  font-size: 1.5rem;
}

.metric-selector .name {
  font-size: 0.9rem;
  font-weight: 600;
}

.metric-selector .goal-hint {
  font-size: 0.75rem;
  opacity: 0.8;
  font-weight: 500;
}

/* Comparison Card */
.comparison-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.chart-section {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.metric-display {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--vp-c-bg);
  border-radius: 12px;
}

.metric-value {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.metric-value .value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.metric-delta {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 1.1rem;
}

.metric-delta.positive {
  background: rgba(16, 185, 129, 0.1);
  color: var(--vp-c-brand);
}

.metric-delta.negative {
  background: rgba(239, 68, 68, 0.1);
  color: var(--vp-c-danger);
}

/* Bar Chart */
.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.bar-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.bar-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-left: 0.5rem;
}

.bar-label {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.winner-badge {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--vp-c-brand);
  background: rgba(16, 185, 129, 0.1);
  padding: 0.2rem 0.5rem;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.bar-wrapper {
  position: relative;
  background: var(--vp-c-bg);
  border-radius: 8px;
  padding: 0.25rem;
  min-height: 48px;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.bar {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  transition: width 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  color: white;
  font-weight: 600;
  white-space: nowrap;
}

.bar.baseline {
  background: rgba(239, 68, 68, 0.6);
}

.bar.routed {
  background: var(--vp-c-brand);
}

.bar-value {
  font-size: 0.9rem;
  font-weight: 600;
  padding-left: 0.5rem;
}

/* Details Grid */
.details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}

.system-card {
  background: var(--vp-c-bg);
  border-radius: 12px;
  padding: 1.5rem;
  border: 1px solid var(--vp-c-divider);
  transition: all 0.2s;
}

.system-card:hover {
  transform: translateY(-2px);
  border-color: var(--vp-c-brand);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid;
  margin-bottom: 1rem;
}

.card-header h4 {
  margin: 0;
  font-size: 1.15rem;
}

.badge {
  padding: 0.35rem 0.75rem;
  border-radius: 20px;
  color: white;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.card-desc {
  margin: 0 0 1rem 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.metric .label {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-3);
  font-weight: 600;
}

.metric .value {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.test-summary {
  padding: 0.75rem;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  text-align: center;
  font-size: 0.9rem;
  font-weight: 600;
}

.test-summary .passed {
  color: var(--vp-c-brand);
}

.test-summary .failed {
  color: var(--vp-c-danger);
}

/* Insights Section */
.insights-section {
  background: var(--vp-c-bg-soft);
  border-radius: 16px;
  padding: 2rem;
}

.insights-section h4 {
  margin: 0 0 1.5rem 0;
  font-size: 1.25rem;
}

.insights-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.insight-card {
  background: var(--vp-c-bg);
  border-left: 3px solid var(--vp-c-brand);
  border-radius: 8px;
  padding: 1.25rem;
}

.insight-card h5 {
  margin: 0 0 0.75rem 0;
  font-size: 1rem;
  color: var(--vp-c-text-1);
}

.insight-card p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

/* Methodology Section */
.methodology-section {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  padding: 2rem;
}

.methodology-section h4 {
  margin: 0 0 1rem 0;
  font-size: 1.25rem;
}

.methodology-note {
  background: var(--vp-c-bg);
  padding: 1rem;
  border-radius: 8px;
  border-left: 3px solid var(--vp-c-brand);
  margin-bottom: 1.5rem;
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
}

.methodology-note strong {
  color: var(--vp-c-text-1);
}

.methodology-items {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.methodology-items li {
  padding-left: 1.5rem;
  position: relative;
  color: var(--vp-c-text-2);
  font-size: 0.95rem;
  line-height: 1.5;
}

.methodology-items li::before {
  content: "→";
  position: absolute;
  left: 0;
  color: var(--vp-c-brand);
  font-weight: bold;
}

/* Responsive */
@media (max-width: 768px) {
  .comparison-card {
    padding: 1.5rem;
  }

  .metric-selector {
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.75rem;
  }

  .details-grid {
    grid-template-columns: 1fr;
  }

  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .metric-display {
    flex-direction: column;
    gap: 0.5rem;
  }

  .metric-value .value {
    font-size: 1.5rem;
  }

  .insights-section,
  .methodology-section {
    padding: 1.5rem;
  }
}
</style>