import type { SynthesizedInsights } from "./InsightSynthesizerTypes.js";

export function extractDependencyEdges(deps: any): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const list = deps?.edges ?? deps?.links ?? deps?.relationships ?? [];
  if (Array.isArray(list)) {
    for (const edge of list) {
      const from = edge?.from ?? edge?.source;
      const to = edge?.to ?? edge?.target;
      if (from && to) edges.push({ from, to });
    }
  }
  return edges;
}

export function computePageRankFromCalls(calls: any): Map<string, number> | undefined {
  const edges = extractDependencyEdges(calls);
  if (edges.length === 0) return undefined;

  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  const ids = Array.from(nodes);
  const n = ids.length;
  if (n === 0) return undefined;

  const outgoing = new Map<string, string[]>();
  for (const id of ids) outgoing.set(id, []);
  for (const edge of edges) {
    outgoing.get(edge.from)!.push(edge.to);
  }

  const damping = 0.85;
  let ranks = new Map<string, number>(ids.map(id => [id, 1 / n]));
  for (let iter = 0; iter < 15; iter++) {
    const next = new Map<string, number>(ids.map(id => [id, (1 - damping) / n]));
    for (const id of ids) {
      const outs = outgoing.get(id) ?? [];
      const share = (ranks.get(id) ?? 0) / (outs.length || n);
      if (outs.length === 0) {
        for (const other of ids) {
          next.set(other, (next.get(other) ?? 0) + damping * share);
        }
      } else {
        for (const to of outs) {
          next.set(to, (next.get(to) ?? 0) + damping * share);
        }
      }
    }
    ranks = next;
  }

  return ranks;
}

export function buildPageRankSummary(pageRank?: Map<string, number>): SynthesizedInsights["pageRankSummary"] {
  if (!pageRank || pageRank.size === 0) return undefined;
  const entries = Array.from(pageRank.entries()).sort((a, b) => b[1] - a[1]);
  const topNodes = entries.slice(0, 5).map(([id, score]) => ({ id, score }));
  return {
    coverage: pageRank.size,
    topNodes
  };
}

export function buildHotSpotSummary(hotSpots: any[]): SynthesizedInsights["hotSpotSummary"] {
  if (!hotSpots || hotSpots.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const spot of hotSpots) {
    const filePath = spot?.filePath;
    if (!filePath) continue;
    counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
  }
  const topFiles = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([filePath, count]) => ({ filePath, count }));
  return {
    count: hotSpots.length,
    topFiles
  };
}

export function buildImpactSummary(previews: any[]): SynthesizedInsights["impactSummary"] {
  if (!previews || previews.length === 0) return undefined;
  const riskCounts = { high: 0, medium: 0, low: 0 };
  const impacted = new Set<string>();
  for (const preview of previews) {
    const level = preview?.riskLevel;
    if (level === "high") riskCounts.high += 1;
    else if (level === "medium") riskCounts.medium += 1;
    else riskCounts.low += 1;
    for (const file of preview?.summary?.impactedFiles ?? []) {
      impacted.add(file);
    }
  }
  return {
    riskCounts,
    impactedFiles: Array.from(impacted)
  };
}

export function buildPageRankDetail(pageRank?: Map<string, number>): SynthesizedInsights["pageRank"] {
  if (!pageRank || pageRank.size === 0) return undefined;
  const entries = Array.from(pageRank.entries()).sort((a, b) => b[1] - a[1]);
  const topNodes = entries.slice(0, 10).map(([pathValue, score]) => ({
    path: pathValue,
    symbol: pathValue,
    score,
    role: classifyRole(score)
  }));

  const distribution = { core: 0, utility: 0, integration: 0, peripheral: 0 };
  for (const [, score] of entries) {
    distribution[classifyRole(score)] += 1;
  }

  return { topNodes, distribution };
}

export function buildHotSpotDetail(hotSpots: any[]): SynthesizedInsights["hotSpots"] {
  if (!hotSpots || hotSpots.length === 0) return undefined;
  const clustered: Record<string, any[]> = {};
  let totalScore = 0;
  for (const spot of hotSpots) {
    const filePath = spot?.filePath ?? "unknown";
    if (!clustered[filePath]) clustered[filePath] = [];
    clustered[filePath].push(spot);
    totalScore += typeof spot?.score === "number" ? spot.score : 1;
  }
  const fileCount = Object.keys(clustered).length;
  const riskSummary = `${hotSpots.length} hotspots across ${fileCount} files.`;
  return {
    detected: hotSpots,
    clusteredByFile: clustered,
    totalScore,
    riskSummary
  };
}

export function buildImpactDetail(deps: any, previews: any[]): SynthesizedInsights["impact"] {
  const edges = extractDependencyEdges(deps);
  const blastRadiusByFile: Record<string, number> = {};
  for (const edge of edges) {
    blastRadiusByFile[edge.from] = (blastRadiusByFile[edge.from] ?? 0) + 1;
  }
  const highRiskFiles = Array.from(new Set(
    previews.filter(p => p?.riskLevel === "high").flatMap(p => p?.summary?.impactedFiles ?? [])
  ));
  return {
    highRiskFiles,
    blastRadiusByFile,
    breakingChangeIndicators: []
  };
}

export function countSymbols(skeletons: any[]): number {
  return skeletons.reduce((acc, s) => {
    if (Array.isArray(s?.symbols)) return acc + s.symbols.length;
    if (Array.isArray(s?.metadata?.symbols)) return acc + s.metadata.symbols.length;
    return acc;
  }, 0);
}

export function generateMermaid(data: any): string | undefined {
  const edges = extractDependencyEdges(data.dependencies ?? data.calls);
  if (edges.length === 0) return undefined;

  const pageRank = data.pageRank ?? computePageRankFromCalls(data.calls);
  const hotSpotFiles = new Set((data.hotSpots ?? []).map((hs: any) => hs?.filePath).filter(Boolean));
  const ranked: Array<[string, number]> = pageRank && typeof (pageRank as Map<string, number>).entries === "function"
    ? (Array.from((pageRank as Map<string, number>).entries()) as Array<[string, number]>)
    : [];
  ranked.sort((a, b) => b[1] - a[1]);
  const topNodes: Array<{ id: string; score: number; role: "core" | "utility" | "integration" | "peripheral" }> =
    ranked.slice(0, 12).map(([id, score]) => ({ id, score, role: classifyRole(score) }));
  const topSet = new Set(topNodes.map((node) => node.id));

  let mermaid = "graph TD\n";
  for (const node of topNodes) {
    const label = node.id.split("/").pop() ?? node.id;
    const style = hotSpotFiles.has(node.id)
      ? ":::hotspot"
      : node.role === "core"
        ? ":::core"
        : node.role === "integration"
          ? ":::integration"
          : node.role === "utility"
            ? ":::utility"
            : "";
    mermaid += `  ${sanitizeId(node.id)}["${label}"]${style}\n`;
  }

  edges
    .filter(edge => topSet.has(edge.from) || topSet.has(edge.to))
    .slice(0, 30)
    .forEach(edge => {
      mermaid += `  ${sanitizeId(edge.from)} --> ${sanitizeId(edge.to)}\n`;
    });

  mermaid += "\n  classDef hotspot fill:#ff6b6b,stroke:#c92a2a\n";
  mermaid += "  classDef core fill:#4ecdc4,stroke:#099268\n";
  mermaid += "  classDef integration fill:#ffd43b,stroke:#fab005\n";
  mermaid += "  classDef utility fill:#74c0fc,stroke:#1c7ed6\n";

  return mermaid;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

function classifyRole(score: number): "core" | "utility" | "integration" | "peripheral" {
  if (score >= 0.15) return "core";
  if (score >= 0.08) return "integration";
  if (score >= 0.04) return "utility";
  return "peripheral";
}
