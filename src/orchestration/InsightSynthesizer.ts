import type { Insight, SynthesizedInsights } from "./InsightSynthesizerTypes.js";
import {
  buildHotSpotDetail,
  buildHotSpotSummary,
  buildImpactDetail,
  buildImpactSummary,
  buildPageRankDetail,
  buildPageRankSummary,
  computePageRankFromCalls,
  countSymbols,
  extractDependencyEdges,
  generateMermaid
} from "./InsightSynthesizerUtils.js";

export type { Insight, SynthesizedInsights } from "./InsightSynthesizerTypes.js";

/**
 * InsightSynthesizer: 로우 데이터를 분석하여 아키텍처적 통찰과 리스크를 추출합니다.
 */
export class InsightSynthesizer {
  /**
   * 수집된 분석 데이터들로부터 종합적인 인사이트를 생성합니다.
   */
  public synthesize(data: {
    skeletons: any[];
    calls: any;
    dependencies: any;
    hotSpots?: any[];
    pageRank?: Map<string, number>;
    impactPreviews?: any[];
  }): SynthesizedInsights {
    const insights: Insight[] = [];
    const derivedPageRank = data.pageRank ?? computePageRankFromCalls(data.calls);

    // 1. God Class/Module Detection (High Centrality)
    if (derivedPageRank) {
      this.detectGodModules(derivedPageRank, insights);
    }

    // 2. High Blast Radius Detection (Complex Dependencies)
    if (data.dependencies) {
      this.detectHighImpactAreas(data.dependencies, insights);
      this.detectHighBlastRadius(data.dependencies, insights);
    }

    // 3. HotSpot Concentration (Maintenance Risk)
    if (data.hotSpots) {
      this.detectMaintenanceRisks(data.hotSpots, insights);
      this.detectHotSpotConcentration(data.hotSpots, insights);
    }

    // 4. Circular Dependencies
    if (data.dependencies) {
      this.detectCircularDependencies(data.dependencies, insights);
    }

    // 5. Impact Risk Integration
    if (data.impactPreviews && data.impactPreviews.length > 0) {
      this.detectImpactRisks(data.impactPreviews, insights);
    }

    const pageRankSummary = buildPageRankSummary(derivedPageRank);
    const hotSpotSummary = buildHotSpotSummary(data.hotSpots ?? []);
    const impactSummary = buildImpactSummary(data.impactPreviews ?? []);
    const pageRankDetail = buildPageRankDetail(derivedPageRank);
    const hotSpotDetail = buildHotSpotDetail(data.hotSpots ?? []);
    const impactDetail = buildImpactDetail(data.dependencies, data.impactPreviews ?? []);

    return {
      overview: {
        filesAnalyzed: data.skeletons.length,
        symbolsDiscovered: countSymbols(data.skeletons),
        generatedAt: new Date().toISOString()
      },
      insights,
      pageRankSummary,
      pageRank: pageRankDetail,
      hotSpotSummary,
      hotSpots: hotSpotDetail,
      impactSummary,
      impact: impactDetail,
      visualization: generateMermaid(data)
    };
  }

  private detectGodModules(pageRank: Map<string, number>, insights: Insight[]): void {
    for (const [path, score] of pageRank.entries()) {
      if (score > 0.8) {
        insights.push({
          type: 'architecture',
          severity: 'high',
          observation: `Module "${path}" shows very high centrality (PageRank: ${score.toFixed(2)}).`,
          implication: 'This module likely acts as a "God Module" with too many responsibilities.',
          risk: 'Modifying this file may have broad side effects across the project.',
          actionSuggestion: 'Consider refactoring into smaller, specialized components.',
          affectedFiles: [path],
          confidence: 0.9
        });
      }
    }
  }

  private detectHighImpactAreas(deps: any, insights: Insight[]): void {
    // 의존성 그래프 분석 로직 (간소화)
    if (deps.nodes?.length > 20) {
      insights.push({
        type: 'risk',
        severity: 'medium',
        observation: 'Complex dependency cluster detected.',
        implication: 'Tight coupling between modules increases refactoring difficulty.',
        actionSuggestion: 'Use "relationship_analyze" with depth 3 to explore sub-clusters.',
        affectedFiles: [],
        confidence: 0.8
      });
    }
  }

  private detectMaintenanceRisks(hotSpots: any[], insights: Insight[]): void {
    if (hotSpots.length > 5) {
      insights.push({
        type: 'maintenance',
        severity: 'medium',
        observation: `${hotSpots.length} active hotspots identified in this area.`,
        implication: 'This region changes frequently and is prone to regression bugs.',
        actionSuggestion: 'Ensure high test coverage before making changes.',
        affectedFiles: hotSpots.map(h => h.filePath),
        confidence: 0.85
      });
    }
  }

  private detectHighBlastRadius(deps: any, insights: Insight[]): void {
    const edges = extractDependencyEdges(deps);
    if (edges.length === 0) return;

    const outDegree = new Map<string, number>();
    for (const edge of edges) {
      outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    }

    const high = Array.from(outDegree.entries()).filter(([, count]) => count >= 10);
    if (high.length === 0) return;

    insights.push({
      type: 'risk',
      severity: 'high',
      observation: `${high.length} files show large dependency fan-out.`,
      implication: 'Changes in these files may impact many downstream modules.',
      risk: 'Broad regression risk without targeted tests.',
      actionSuggestion: 'Use change with dryRun and includeImpact before editing.',
      affectedFiles: high.map(([path]) => path),
      confidence: 0.9
    });
  }

  private detectHotSpotConcentration(hotSpots: any[], insights: Insight[]): void {
    const byFile = new Map<string, number>();
    for (const hs of hotSpots) {
      const file = hs?.filePath;
      if (!file) continue;
      byFile.set(file, (byFile.get(file) ?? 0) + 1);
    }
    const concentrated = Array.from(byFile.entries()).filter(([, count]) => count >= 3);
    if (concentrated.length > 0) {
      insights.push({
        type: 'maintenance',
        severity: 'medium',
        observation: `${concentrated.length} files show concentrated hotspots.`,
        implication: 'Hotspot concentration indicates potential maintenance risk.',
        actionSuggestion: 'Consider refactoring or adding targeted tests.',
        affectedFiles: concentrated.map(([path]) => path),
        confidence: 0.8
      });
    }
  }

  private detectCircularDependencies(deps: any, insights: Insight[]): void {
    const edges = extractDependencyEdges(deps);
    if (edges.length === 0) return;

    const graph = new Map<string, string[]>();
    for (const { from, to } of edges) {
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from)!.push(to);
    }

    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (node: string, stack: string[]) => {
      if (visiting.has(node)) {
        const idx = stack.indexOf(node);
        if (idx >= 0) cycles.push(stack.slice(idx));
        return;
      }
      if (visited.has(node)) return;
      visiting.add(node);
      stack.push(node);
      const next = graph.get(node) ?? [];
      for (const neighbor of next) {
        dfs(neighbor, stack);
      }
      stack.pop();
      visiting.delete(node);
      visited.add(node);
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) dfs(node, []);
    }

    if (cycles.length > 0) {
      insights.push({
        type: 'dependency',
        severity: 'medium',
        observation: `${cycles.length} circular dependencies detected.`,
        implication: 'Cyclic dependencies increase refactoring complexity and risk.',
        actionSuggestion: 'Use understand pillar to analyze module boundaries.',
        affectedFiles: Array.from(new Set(cycles.flat())),
        confidence: 0.9
      });
    }
  }

  private detectImpactRisks(previews: any[], insights: Insight[]): void {
    const high = previews.filter(p => p?.riskLevel === 'high');
    const medium = previews.filter(p => p?.riskLevel === 'medium');
    if (high.length === 0 && medium.length === 0) return;

    const level = high.length > 0 ? 'high' : 'medium';
    const sample = (high.length > 0 ? high : medium)[0];
    const affectedFiles = Array.from(new Set(previews.flatMap(p => p?.summary?.impactedFiles ?? []).filter(Boolean)));

    insights.push({
      type: 'risk',
      severity: level,
      observation: `Impact analysis indicates ${level} risk for upcoming changes.`,
      implication: 'Changes may affect multiple dependent modules.',
      risk: 'Regression risk increases with blast radius.',
      actionSuggestion: 'Run suggested tests and review suggested files before applying changes.',
      affectedFiles,
      confidence: 0.85
    });
  }

}
