import type { LRUCache } from "lru-cache";
import { AnalysisPackBuilder } from "../../../generation/analysis-pack-builder.js";
import { VibeProfileBuilder } from "../../../generation/vibe-profile-builder.js";
import type { AnalysisPack, StylePack, GraphPack } from "../../../types/flow-artifacts.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import {
  DEFAULT_CALLGRAPH_ARTIFACT_TTL_MS,
  DEFAULT_CALLGRAPH_MAX_EDGES,
  DEFAULT_CALLGRAPH_MAX_NODES,
  DEFAULT_CALLGRAPH_PREVIEW_EDGES,
  DEFAULT_CALLGRAPH_PREVIEW_NODES,
  DEFAULT_CALLGRAPH_TOP_NODES
} from "./UnderstandPillarDefaults.js";

export function buildGraphPack(input: {
  calls: any;
  filePath: string;
  symbolName?: string | null;
  depth: string;
}): {
  pack: GraphPack;
  preview: { nodes: any[]; edges: any[]; resolvedTarget?: any; meta?: any };
  expiresAt: number;
} {
  const rawNodes = Array.isArray(input.calls?.nodes) ? input.calls.nodes : [];
  const rawEdges = Array.isArray(input.calls?.edges) ? input.calls.edges : [];
  const totalNodes = rawNodes.length;
  const totalEdges = rawEdges.length;
  const maxNodes = DEFAULT_CALLGRAPH_MAX_NODES;
  const maxEdges = DEFAULT_CALLGRAPH_MAX_EDGES;
  let cappedNodes = rawNodes;
  let cappedEdges = rawEdges;
  let truncatedByCap = false;

  if (Number.isFinite(maxNodes) && maxNodes > 0 && cappedNodes.length > maxNodes) {
    cappedNodes = cappedNodes.slice(0, maxNodes);
    truncatedByCap = true;
  }
  const nodeIds = new Set(cappedNodes.map((node: any) => node.id));
  cappedEdges = cappedEdges.filter((edge: any) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  if (Number.isFinite(maxEdges) && maxEdges > 0 && cappedEdges.length > maxEdges) {
    cappedEdges = cappedEdges.slice(0, maxEdges);
    truncatedByCap = true;
  }
  const truncatedReason = input.calls?.truncatedReason as ("cap" | "depth" | "unknown" | undefined);
  if (truncatedReason === "cap") {
    truncatedByCap = true;
  }

  const degreeMap = new Map<string, number>();
  for (const edge of cappedEdges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }
  type NodeDegree = { node: any; degree: number };
  const topNodes = cappedNodes
    .map((node: any): NodeDegree => ({ node, degree: degreeMap.get(node.id) ?? 0 }))
    .sort((left: NodeDegree, right: NodeDegree) => right.degree - left.degree)
    .slice(0, DEFAULT_CALLGRAPH_TOP_NODES)
    .map((entry: NodeDegree) => ({
      label: entry.node.label ?? entry.node.id,
      filePath: entry.node.path,
      degree: entry.degree
    }));

  const mode = input.calls?.resolvedTarget?.type === "file" ? "file" : "symbol";
  const createdAt = Date.now();
  const pack: GraphPack = {
    id: generateGraphPackId(),
    kind: "call_graph",
    source: {
      filePath: input.filePath,
      ...(input.symbolName ? { symbolName: input.symbolName } : {}),
      ...(input.depth ? { depth: input.depth } : {})
    },
    raw: {
      nodes: cappedNodes,
      edges: cappedEdges,
      resolvedTarget: input.calls?.resolvedTarget
    },
    summary: {
      mode,
      truncated: input.calls?.truncated === true || truncatedByCap || totalNodes !== cappedNodes.length || totalEdges !== cappedEdges.length,
      ...(truncatedReason ? { truncatedReason } : {}),
      totalNodes,
      totalEdges,
      topNodes
    },
    meta: {
      createdAt,
      totalNodes,
      totalEdges,
      truncatedByCap,
      ...(truncatedReason ? { truncatedReason } : {}),
      caps: {
        maxNodes,
        maxEdges
      }
    }
  };

  const previewNodes = cappedNodes.slice(0, Math.min(DEFAULT_CALLGRAPH_PREVIEW_NODES, cappedNodes.length));
  const previewNodeIds = new Set(previewNodes.map((node: any) => node.id));
  const previewEdges = cappedEdges
    .filter((edge: any) => previewNodeIds.has(edge.source) && previewNodeIds.has(edge.target))
    .slice(0, DEFAULT_CALLGRAPH_PREVIEW_EDGES);

  return {
    pack,
    expiresAt: createdAt + DEFAULT_CALLGRAPH_ARTIFACT_TTL_MS,
    preview: {
      nodes: previewNodes,
      edges: previewEdges,
      resolvedTarget: input.calls?.resolvedTarget,
      meta: {
        mode,
        truncated: pack.summary.truncated,
        totalNodes,
        totalEdges,
        artifactId: pack.id
      }
    }
  };
}

export function buildSkeletonDigest(profile: any): string | undefined {
  const symbols = profile?.structure?.symbols;
  if (!Array.isArray(symbols) || symbols.length === 0) return undefined;
  const lines = symbols.slice(0, 20).map((symbol: any) => {
    const type = symbol?.type ?? "symbol";
    const name = symbol?.name ?? symbol?.text ?? "unknown";
    const signature = symbol?.signature ? ` ${symbol.signature}` : "";
    return `- ${type} ${name}${signature}`;
  });
  return ["// Digest (symbols)", ...lines].join("\n");
}

export function buildAnalysisPack(input: {
  goal: string;
  primaryFile?: string;
  searchResults?: Array<{ path?: string; score?: number; reason?: string }>;
  dependencyEdges?: Array<{ from: string; to: string; type?: string }>;
  hotSpots?: Array<{ path?: string; score?: number; reason?: string }>;
  degraded: boolean;
  analysis?: { maxClusters?: number; maxFilesPerCluster?: number };
}): AnalysisPack {
  const builder = new AnalysisPackBuilder({
    maxClusters: input.analysis?.maxClusters,
    maxFilesPerCluster: input.analysis?.maxFilesPerCluster
  });
  return builder.build({
    goal: input.goal,
    primaryFile: input.primaryFile,
    searchResults: input.searchResults,
    dependencyEdges: input.dependencyEdges,
    hotSpots: input.hotSpots,
    degraded: input.degraded
  });
}

export async function buildStylePack(args: {
  filePath: string;
  vibe?: { scope?: string; includeNorms?: boolean };
  indexSnapshot?: { epoch?: number; dirtyFileCount?: number };
  sessionId?: string;
  intent?: string;
  registry: { getMetadata: <T>(key: string) => T | undefined };
  styleCache: LRUCache<string, StylePack>;
  styleCacheTtlMs: number;
}): Promise<StylePack | undefined> {
  const { filePath, vibe, indexSnapshot, sessionId, intent, registry, styleCache, styleCacheTtlMs } = args;
  const cacheKey = getStyleCacheKey(vibe, indexSnapshot);
  if (cacheKey) {
    const cached = styleCache.get(cacheKey);
    if (cached) {
      if (sessionId) {
        const derived: StylePack = {
          ...cached,
          id: generateStylePackId(),
          createdAt: Date.now(),
          expiresAt: Date.now() + styleCacheTtlMs
        };
        const artifactManager = registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
        if (artifactManager) {
          artifactManager.store({
            id: derived.id,
            type: "style",
            createdAt: derived.createdAt,
            expiresAt: derived.expiresAt,
            pack: derived,
            sessionId,
            metadata: intent ? { intent } : undefined
          });
        }
        return derived;
      }
      return cached;
    }
  }
  const builder = VibeProfileBuilder.create(process.cwd(), {
    includeNorms: vibe?.includeNorms !== false,
    scopeGlob: vibe?.scope
  });
  const pack = await builder.build(filePath);
  const artifactManager = registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
  if (artifactManager) {
    artifactManager.store({
      id: pack.id,
      type: "style",
      createdAt: pack.createdAt,
      expiresAt: pack.expiresAt,
      pack,
      sessionId,
      metadata: intent ? { intent } : undefined
    });
  }
  if (cacheKey) {
    styleCache.set(cacheKey, pack);
  }
  return pack;
}

export function getStyleCacheKey(
  vibe: { scope?: string; includeNorms?: boolean } | undefined,
  indexSnapshot?: { epoch?: number; dirtyFileCount?: number }
): string | undefined {
  if (indexSnapshot?.dirtyFileCount && indexSnapshot.dirtyFileCount > 0) {
    return undefined;
  }
  const scope = vibe?.scope ?? "**/*";
  const includeNorms = vibe?.includeNorms !== false ? "norms" : "no-norms";
  const epoch = indexSnapshot?.epoch ?? 0;
  return `style:${scope}:${includeNorms}:epoch:${epoch}`;
}

function generateGraphPackId(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `graph_${Date.now().toString(36)}_${suffix}`;
}

function generateStylePackId(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `style_${Date.now().toString(36)}_${suffix}`;
}
