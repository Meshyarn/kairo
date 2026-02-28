import { BaseHandler } from "../BaseHandler.js";
import type { HandlerContext } from "../HandlerContext.js";

export class KairoGraphHandler extends BaseHandler {
  private context: HandlerContext;

  constructor(context: HandlerContext) {
    super(context.toolSpecRegistry);
    this.context = context;
  }

  async handle(name: string, args: any): Promise<any> {
    if (name !== "kairo_graph") return null;

    const { focus, scope = "module", include = ["dependencies"] } = args;

    try {
      const result: any = { nodes: [], edges: [] };

      // 1. Dependencies graph
      if (include.includes("dependencies") && focus) {
        const maxDepth = scope === "project" ? 4 : 2;
        const graph = await this.context.callGraphBuilder.analyzeSymbol(
          focus,
          "",
          "both",
          maxDepth,
        );

        if (graph) {
          const visitedNodes = graph.visitedNodes ?? {};
          result.nodes = Object.values(visitedNodes).map((n: any) => ({
            id: n.symbolId ?? n.id ?? "",
            name: n.symbolName ?? n.name ?? "",
            file: n.filePath ?? n.file ?? "",
            type: n.symbolType ?? n.type ?? "unknown",
          }));
          result.edges = this.extractEdges(graph);
        }
      }

      // 2. Hot spots
      if (include.includes("hotSpots") && this.context.hotSpotDetector) {
        try {
          const spots = await this.context.hotSpotDetector.detectHotSpots();
          result.hotSpots = spots.slice(0, 10).map((s: any) => ({
            file: s.filePath ?? "",
            symbol: s.symbol?.name ?? s.symbol?.symbolName ?? "",
            score: s.score ?? 0,
            reasons: s.reasons ?? [],
          }));
        } catch {
          result.hotSpots = [];
        }
      }

      // 3. Entry points
      if (include.includes("entryPoints")) {
        try {
          const entryPoints = (this.context.dependencyGraph as any).getEntryPoints?.() ?? [];
          result.entryPoints = (Array.isArray(entryPoints) ? entryPoints : []).slice(0, 20).map(
            (e: any) => ({
              file: typeof e === "string" ? e : e.filePath ?? e.path ?? "",
            }),
          );
        } catch {
          result.entryPoints = [];
        }
      }

      // 4. Clusters via GraphRagClusterService
      if (include.includes("clusters") && this.context.graphRagClusterService) {
        try {
          const clusterResult =
            await this.context.graphRagClusterService.buildClusters({
              query: focus || "",
            });
          if (clusterResult?.clusters) {
            result.clusters = clusterResult.clusters.map((c: any) => ({
              id: c.clusterId ?? c.id ?? "",
              entryPoint: c.entryPoint ?? null,
              relevance: c.relevanceScore ?? c.relevance ?? 0,
              fileCount:
                (c.relationships?.dependency?.count ?? 0) +
                (c.relationships?.colocated?.count ?? 0),
            }));
          }
        } catch {
          result.clusters = [];
        }
      }

      return this.jsonResponse(result);
    } catch (error: any) {
      return this.errorResponse(
        "GraphError",
        error?.message ?? "Graph analysis failed",
      );
    }
  }

  private extractEdges(graph: any): Array<{
    from: string;
    to: string;
    type: string;
  }> {
    const edges: Array<{ from: string; to: string; type: string }> = [];

    // Extract edges from visitedNodes' callers/callees
    const visitedNodes = graph.visitedNodes ?? graph.nodes ?? {};
    for (const node of Object.values(visitedNodes) as any[]) {
      const nodeId = node.symbolId ?? node.id ?? "";
      const callees = node.callees ?? node.children ?? [];
      for (const calleeId of callees) {
        edges.push({
          from: nodeId,
          to: typeof calleeId === "string" ? calleeId : calleeId?.symbolId ?? "",
          type: "calls",
        });
      }
    }

    return edges;
  }
}
