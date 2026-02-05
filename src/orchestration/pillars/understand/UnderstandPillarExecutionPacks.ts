import type { AnalysisPack, StylePack } from "../../../types/flow-artifacts.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import type { LRUCache } from "lru-cache";
import { buildAnalysisPack, buildStylePack } from "./UnderstandPillarArtifacts.js";
import type { UnderstandExecutionSetup } from "./UnderstandPillarExecutionSetup.js";

export async function buildUnderstandPacks(args: {
  setup: UnderstandExecutionSetup;
  artifactManager?: FlowArtifactManager;
  registry: { getMetadata: <T>(key: string) => T | undefined };
  styleCache: LRUCache<string, StylePack>;
  styleCacheTtlMs: number;
  filePath: string;
  searchResults?: Array<{ path?: string; score?: number; reason?: string }>;
  deps?: { edges?: Array<{ from: string; to: string; type?: string }> };
  hotSpots?: Array<{ path?: string; score?: number; reason?: string }>;
  analysis?: { maxClusters?: number; maxFilesPerCluster?: number };
  indexSnapshot?: { epoch?: number; dirtyFileCount?: number };
  degraded: boolean;
}): Promise<{ analysisPack?: AnalysisPack; stylePack?: StylePack }> {
  const { setup, artifactManager, registry, styleCache, styleCacheTtlMs, filePath, searchResults, deps, hotSpots, analysis, indexSnapshot, degraded } = args;
  const { input } = setup;

  let analysisPack: AnalysisPack | undefined;
  if (setup.wantsAnalysisPlanned) {
    if (setup.analysisPlan?.strategy === "summary" && input.resolvedSessionId && artifactManager) {
      analysisPack = artifactManager.getLatestAnalysisPack(input.resolvedSessionId);
      if (analysisPack && setup.traceBuilder) {
        setup.traceBuilder.recordEvent({
          area: "budget",
          code: "allocator.reuse_pack",
          data: { section: "analysis_pack" }
        });
      }
    }
    if (!analysisPack) {
      analysisPack = buildAnalysisPack({
        goal: input.subject,
        primaryFile: filePath,
        searchResults,
        dependencyEdges: deps?.edges,
        hotSpots,
        degraded,
        analysis
      });
    }
  }

  if (analysisPack && artifactManager) {
    artifactManager.store({
      id: analysisPack.id,
      type: "analysis",
      createdAt: analysisPack.createdAt,
      pack: analysisPack,
      sessionId: input.resolvedSessionId,
      metadata: { intent: input.subject }
    });
  }

  let stylePack: StylePack | undefined;
  if (setup.wantsVibePlanned) {
    if (setup.stylePlan?.strategy === "summary" && input.resolvedSessionId && artifactManager) {
      stylePack = artifactManager.getLatestStylePack(input.resolvedSessionId);
      if (stylePack && setup.traceBuilder) {
        setup.traceBuilder.recordEvent({
          area: "budget",
          code: "allocator.reuse_pack",
          data: { section: "style_pack" }
        });
      }
    }
    if (!stylePack) {
      stylePack = await buildStylePack({
        filePath,
        vibe: input.vibe,
        indexSnapshot,
        sessionId: input.resolvedSessionId,
        intent: input.subject,
        registry,
        styleCache,
        styleCacheTtlMs
      });
    }
  }

  return { analysisPack, stylePack };
}
