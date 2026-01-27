<script setup>
import DefaultTheme from "vitepress/theme"
import HeroAnimation from './components/HeroAnimation.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #home-hero-image>
      <HeroAnimation />
    </template>
  </Layout>
</template>

<style scoped>
</style>
