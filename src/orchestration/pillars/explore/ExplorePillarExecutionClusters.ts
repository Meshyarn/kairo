import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { InternalToolRegistry } from "../../InternalToolRegistry.js";
import type { ExploreResponse } from "./ResultFormatter.js";
import { GraphRagClusterService } from "../../cluster/GraphRagClusterService.js";
import type { ExploreExecutionSetup } from "./ExplorePillarExecutionSetup.js";
import type { ExploreExecutionState } from "./ExplorePillarExecutionState.js";

export async function executeExploreClusters(args: {
    setup: ExploreExecutionSetup;
    state: ExploreExecutionState;
    response: ExploreResponse;
    registry: InternalToolRegistry;
    context: OrchestrationContext;
}): Promise<void> {
  const { setup, state, response, registry } = args;
  const query = setup.input.query;
  if (!setup.input.includeClusters || !query) return;
  if (setup.hasDeadline && setup.timeRemaining() < 1200) {
    state.degraded = true;
    if (!state.reasons.includes("budget_exceeded")) {
      state.reasons.push("budget_exceeded");
    }
    if (setup.traceBuilder) {
      setup.traceBuilder.recordSkip("clusters", "budget_exceeded", "timeout guard");
    }
    return;
  }

  const graphRagService = registry.getMetadata<GraphRagClusterService>("graphRagClusterService")
        ?? GraphRagClusterService.fromRegistry(registry);
    if (!registry.getMetadata("graphRagClusterService")) {
        registry.setMetadata("graphRagClusterService", graphRagService);
    }
    const clusterResult = await graphRagService.buildClusters({
        query,
        clusterOptions: setup.input.clusterOptions,
        projectFileCount: setup.projectStats?.fileCount,
        docHint: setup.docHint,
        repoScope: (setup.input.constraints as any).repoScope,
        repoId: (setup.input.constraints as any).repoId,
        repoIds: (setup.input.constraints as any).repoIds,
        allowCrossRepoEdits: (setup.input.constraints as any).allowCrossRepoEdits
    });
    if (clusterResult) {
        response.clusters = clusterResult.clusters;
        response.clusterPolicy = clusterResult.policy;
        if (setup.traceBuilder) {
            setup.traceBuilder.recordEvent({
                area: "policy",
                code: "graphrag_clusters",
                data: {
                    policy: clusterResult.policy,
                    clusters: clusterResult.clusters.length,
                    degradedReasons: clusterResult.degradedReasons
                }
            });
        }
        if (clusterResult.degradedReasons?.length) {
            state.degraded = true;
            state.reasons.push(...clusterResult.degradedReasons);
        }
    }
}
