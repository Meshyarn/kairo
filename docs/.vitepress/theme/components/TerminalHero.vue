<script setup lang="ts">
import { computed, ref, onMounted } from "vue"
import { useData } from "vitepress"

const { lang } = useData()
const isKo = computed(() => (lang.value ?? "").toLowerCase().startsWith("ko"))
const lines = computed(() =>
  isKo.value
    ? [
        "> 오프라인 베이스라인 구축...",
        "> 증거 기반(Evidence-based) 툴셋 로딩...",
        "> 쓰기 안전 계약(Safety Contracts) 검증...",
        "> KAIRO 엔진: 온라인."
      ]
    : [
        "> Establishing offline baseline...",
        "> Loading evidence-based toolset...",
        "> Verifying write-safety contracts...",
        "> KAIRO ENGINE: ONLINE."
      ]
)

const displayedLines = ref<string[]>([])
const currentLineIndex = ref(0)
const currentCharIndex = ref(0)
const isFinished = ref(false)

const typeText = () => {
  if (currentLineIndex.value >= lines.value.length) {
    isFinished.value = true
    return
  }

  const currentLine = lines.value[currentLineIndex.value]
  
  if (currentCharIndex.value < currentLine.length) {
    if (!displayedLines.value[currentLineIndex.value]) {
      displayedLines.value[currentLineIndex.value] = ""
    }
    displayedLines.value[currentLineIndex.value] += currentLine[currentCharIndex.value]
    currentCharIndex.value++
    setTimeout(typeText, Math.random() * 30 + 20)
  } else {
    displayedLines.value[currentLineIndex.value] += " [OK]"
    currentLineIndex.value++
    currentCharIndex.value = 0
    setTimeout(typeText, 400)
  }
}

onMounted(() => {
  setTimeout(typeText, 500)
})
</script>

<template>
  <div class="terminal-hero">
    <div class="terminal-header">
      <div class="dot red"></div>
      <div class="dot yellow"></div>
      <div class="dot green"></div>
      <span class="title">kairo-server — -zsh — 80x24</span>
    </div>
    <div class="terminal-body">
      <div v-for="(line, index) in displayedLines" :key="index" class="line">
        {{ line }}
      </div>
      <div class="line cursor-line" v-if="!isFinished">
        <span class="cursor">█</span>
      </div>
      <div class="line prompt" v-if="isFinished">
        <span class="green">$</span> <span class="cursor-blink">_</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-hero {
  background: #1e1e1e;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  overflow: hidden;
  margin: 2rem auto;
  max-width: 600px;
  border: 1px solid #333;
}

.terminal-header {
  background: #2d2d2d;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #333;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 6px;
}

.red { background: #ff5f56; }
.yellow { background: #ffbd2e; }
.green { background: #27c93f; }

.title {
  color: #999;
  font-size: 12px;
  margin-left: 12px;
  flex: 1;
  text-align: center;
}

.terminal-body {
  padding: 16px;
  color: #f1f1f1;
  font-size: 14px;
  line-height: 1.5;
  min-height: 160px;
}

.line {
  margin-bottom: 4px;
}

.green {
  color: #27c93f;
}

.cursor {
  animation: blink 1s step-end infinite;
}

.cursor-blink {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
