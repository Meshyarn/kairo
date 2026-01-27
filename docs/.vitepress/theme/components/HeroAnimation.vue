<script setup lang="ts">
import { onMounted, ref } from 'vue'

const isLoaded = ref(false)

onMounted(() => {
  setTimeout(() => {
    isLoaded.value = true
  }, 100)
})
</script>

<template>
  <div class="hero-anim-container" :class="{ loaded: isLoaded }">
    <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" class="hero-svg">
      <defs>
        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:var(--vp-c-brand);stop-opacity:0.2" />
          <stop offset="100%" style="stop-color:var(--vp-c-brand-dark);stop-opacity:0.8" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <!-- Background Orbit (Noise) -->
      <g class="orbit-group">
        <circle cx="200" cy="200" r="140" fill="none" stroke="var(--vp-c-divider)" stroke-width="1" stroke-dasharray="4 4" opacity="0.3" class="orbit orbit-1" />
        <circle cx="200" cy="200" r="100" fill="none" stroke="var(--vp-c-text-3)" stroke-width="1" opacity="0.2" class="orbit orbit-2" />
      </g>

      <!-- Floating Particles (Data) -->
      <g class="particles">
        <circle cx="200" cy="60" r="4" fill="var(--vp-c-text-3)" opacity="0.5" class="particle p1" />
        <circle cx="340" cy="200" r="3" fill="var(--vp-c-text-3)" opacity="0.4" class="particle p2" />
        <circle cx="200" cy="340" r="4" fill="var(--vp-c-text-3)" opacity="0.5" class="particle p3" />
        <circle cx="60" cy="200" r="3" fill="var(--vp-c-text-3)" opacity="0.4" class="particle p4" />
      </g>

      <!-- Connection Lines (Beams) -->
      <g class="beams">
        <line x1="200" y1="200" x2="200" y2="60" stroke="var(--vp-c-brand)" stroke-width="2" class="beam b1" />
        <line x1="200" y1="200" x2="340" y2="200" stroke="var(--vp-c-brand)" stroke-width="2" class="beam b2" />
        <line x1="200" y1="200" x2="200" y2="340" stroke="var(--vp-c-brand)" stroke-width="2" class="beam b3" />
        <line x1="200" y1="200" x2="60" y2="200" stroke="var(--vp-c-brand)" stroke-width="2" class="beam b4" />
      </g>

      <!-- Central Core (Kairo) -->
      <g class="core" filter="url(#glow)">
        <circle cx="200" cy="200" r="40" fill="url(#grad1)" />
        <circle cx="200" cy="200" r="38" fill="none" stroke="var(--vp-c-brand-light)" stroke-width="2" class="core-pulse" />
        
        <!-- Inner Icon -->
        <path d="M185 185 L215 215 M215 185 L185 215" stroke="white" stroke-width="4" stroke-linecap="round" class="core-x" style="opacity:0" />
        <path d="M190 180 L210 200 L230 180" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="core-check" />
      </g>
      
      <!-- Scan Effect -->
      <circle cx="200" cy="200" r="0" fill="none" stroke="var(--vp-c-brand)" stroke-width="1" opacity="0.5" class="scan-wave" />

    </svg>
  </div>
</template>

<style scoped>
.hero-anim-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.9);
  transition: opacity 1s ease, transform 1s ease;
}

.hero-anim-container.loaded {
  opacity: 1;
  transform: scale(1);
}

.hero-svg {
  width: 100%;
  height: 100%;
  max-width: 400px;
  max-height: 400px;
  overflow: visible;
}

.orbit {
  transform-origin: 200px 200px;
}
.orbit-1 { animation: rotate 20s linear infinite; }
.orbit-2 { animation: rotate 15s linear infinite reverse; }

.particle {
  transform-origin: 200px 200px;
}
.p1 { animation: orbit-p 8s ease-in-out infinite; }
.p2 { animation: orbit-p 12s ease-in-out infinite reverse; }
.p3 { animation: orbit-p 10s ease-in-out infinite; }
.p4 { animation: orbit-p 14s ease-in-out infinite reverse; }

.beam {
  stroke-dasharray: 140;
  stroke-dashoffset: 140;
  animation: beam-shoot 3s ease-out infinite;
  opacity: 0;
}
.b1 { animation-delay: 0s; }
.b2 { animation-delay: 0.5s; }
.b3 { animation-delay: 1s; }
.b4 { animation-delay: 1.5s; }

.core-pulse {
  animation: pulse 3s ease-in-out infinite;
  transform-origin: 200px 200px;
}

.scan-wave {
  animation: wave 3s ease-out infinite;
}

@keyframes rotate {
  100% { transform: rotate(360deg); }
}

@keyframes orbit-p {
  0% { transform: rotate(0deg) translateY(0); }
  50% { transform: rotate(180deg) translateY(-10px); }
  100% { transform: rotate(360deg) translateY(0); }
}

@keyframes beam-shoot {
  0% { stroke-dashoffset: 140; opacity: 1; }
  50% { stroke-dashoffset: 0; opacity: 1; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1); opacity: 0.5; }
}

@keyframes wave {
  0% { r: 40; opacity: 0.8; stroke-width: 2; }
  100% { r: 180; opacity: 0; stroke-width: 0; }
}
</style>