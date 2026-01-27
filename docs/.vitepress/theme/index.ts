import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './style.css'
import TerminalHero from './components/TerminalHero.vue'
import ComparisonCards from './components/ComparisonCards.vue'
import FeatureGrid from './components/FeatureGrid.vue'
import ImpactStats from './components/ImpactStats.vue'
import UserSegments from './components/UserSegments.vue'
import ReadingPath from './components/ReadingPath.vue'
import RoleGuides from './components/RoleGuides.vue'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('TerminalHero', TerminalHero)
    app.component('ComparisonCards', ComparisonCards)
    app.component('FeatureGrid', FeatureGrid)
    app.component('ImpactStats', ImpactStats)
    app.component('UserSegments', UserSegments)
    app.component('ReadingPath', ReadingPath)
    app.component('RoleGuides', RoleGuides)
  }
}
