import { buildUnderstandResponse } from "./ReportGenerator.js";
import { buildDegradedReasons } from "../../DegradedReasonMapper.js";
import { enforceUnderstandResponseBudget } from "../../budget/ResponseEnvelopeBudgeter.js";
import type { AnalysisPack, StylePack } from "../../../types/flow-artifacts.js";
import type { UnderstandExecutionSetup } from "./UnderstandPillarExecutionSetup.js";
import type { UnderstandExecutionState } from "./UnderstandPillarExecutionState.js";
import type { UnderstandCollectedData } from "./UnderstandPillarExecutionCollection.js";
import type { GraphRagClusterResult } from "../../cluster/GraphRagClusterService.js";

export function finalizeUnderstandResponse(args: {
  setup: UnderstandExecutionSetup;
  state: UnderstandExecutionState;
  data: UnderstandCollectedData;
  integrityReport?: any;
  indexSnapshot?: any;
  analysisPack?: AnalysisPack;
  stylePack?: StylePack;
  graphRagClusters?: GraphRagClusterResult | null;
}): any {
  const { setup, state, data, integrityReport, indexSnapshot, analysisPack, stylePack, graphRagClusters } = args;
  const response = buildUnderstandResponse({
    subject: setup.input.subject,
    filePath: data.filePath,
    symbolName: data.symbolName,
    skeleton: data.skeleton,
    profile: setup.profile,
    isDocument: data.isDocument,
    docProfile: data.docProfile,
    docReferences: data.docReferences,
    relatedCode: data.relatedCode,
    callGraph: data.callGraphPreview,
    callGraphArtifactId: data.callGraphArtifactId,
    callGraphSummary: data.callGraphSummary,
    deps: data.deps,
    hotSpots: data.hotSpots,
    integrityReport,
    includeCalls: setup.includeCallsPlanned,
    degraded: state.degraded,
    degradedReasons: state.degradedReasons.length > 0 ? state.degradedReasons : undefined,
    degradedReasonDetails: buildDegradedReasons(state.degradedReasons),
    fallbackGraph: data.fallbackGraph,
    refinementReason: state.refinementReason,
    budget: data.budget,
    allowGraphs: data.allowGraphs,
    indexSnapshot,
    stylePack,
    analysisPack,
    clusters: graphRagClusters?.clusters,
    clusterPolicy: graphRagClusters?.policy,
    sessionId: setup.input.resolvedSessionId,
    compression: data.compressionDecision.compression
  });

  enforceUnderstandResponseBudget({
    response,
    maxTokens: setup.maxTokens,
    maxChars: setup.input.limits.maxChars,
    traceBuilder: setup.traceBuilder
  });
  if (setup.input.traceEnabled) {
    response.effectiveOptions = {
      version: 1,
      pillar: "understand",
      profile: setup.profile,
      sources: setup.input.resolvedOptions.effective.sources,
      depth: setup.depth,
      include: setup.include,
      limits: setup.input.limits
    };
    if (setup.traceBuilder) {
      setup.traceBuilder.setBudget({
        maxTokens: setup.maxTokens,
        maxChars: setup.input.limits.maxChars,
        timeoutMs: setup.input.limits.timeoutMs,
        compressionApplied: data.compressionDecision.compression?.applied,
        compressionMode: data.compressionDecision.compression?.mode
      });
      response.decisionTrace = setup.traceBuilder.finalize();
    }
  }

  return response;
}
