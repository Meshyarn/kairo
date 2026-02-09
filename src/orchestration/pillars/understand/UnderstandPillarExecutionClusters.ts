import { GraphRagClusterService, type GraphRagClusterResult } from "../../cluster/GraphRagClusterService.js";
import type { InternalToolRegistry } from "../../InternalToolRegistry.js";
import type { UnderstandExecutionSetup } from "./UnderstandPillarExecutionSetup.js";
import type { UnderstandExecutionState } from "./UnderstandPillarExecutionState.js";

export async function executeUnderstandClusters(args: {
  setup: UnderstandExecutionSetup;
  state: UnderstandExecutionState;
  registry: InternalToolRegistry;
  projectStats?: any;
  isDocument: boolean;
}): Promise<GraphRagClusterResult | null> {
  const { setup, state, registry, projectStats, isDocument } = args;
  const { input } = setup;
  if (!input.includeClusters) return null;
  if (setup.hasDeadline && setup.timeRemaining() < 1200) {
    state.degraded = true;
    if (!state.degradedReasons.includes("budget_exceeded")) {
      state.degradedReasons.push("budget_exceeded");
    }
    if (setup.traceBuilder) {
      setup.traceBuilder.recordSkip("clusters", "budget_exceeded", "timeout guard");
    }
    return null;
  }
  const graphRagService = registry.getMetadata<GraphRagClusterService>("graphRagClusterService")
    ?? new GraphRagClusterService(registry);
  if (!registry.getMetadata("graphRagClusterService")) {
    registry.setMetadata("graphRagClusterService", graphRagService);
  }
  const graphRagClusters = await graphRagService.buildClusters({
    query: input.subject,
    clusterOptions: input.clusterOptions,
    projectFileCount: projectStats?.fileCount,
    docHint: isDocument,
    repoScope: (input.constraints as any).repoScope,
    repoId: (input.constraints as any).repoId,
    repoIds: (input.constraints as any).repoIds,
    allowCrossRepoEdits: (input.constraints as any).allowCrossRepoEdits
  });
  if (graphRagClusters && setup.traceBuilder) {
    setup.traceBuilder.recordEvent({
      area: "policy",
      code: "graphrag_clusters",
      data: {
        policy: graphRagClusters.policy,
        clusters: graphRagClusters.clusters.length,
        degradedReasons: graphRagClusters.degradedReasons
      }
    });
  }
  if (graphRagClusters?.degradedReasons?.length) {
    state.degraded = true;
    state.degradedReasons.push(...graphRagClusters.degradedReasons);
  }
  return graphRagClusters;
}
