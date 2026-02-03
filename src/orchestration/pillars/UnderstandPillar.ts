
import { LRUCache } from "lru-cache";
import { InternalToolRegistry } from "../InternalToolRegistry.js";
import { OrchestrationContext } from "../OrchestrationContext.js";
import { ParsedIntent } from "../IntentRouter.js";
import { IntegrityEngine } from "../../integrity/IntegrityEngine.js";
import type { IndexStateManager } from '../../indexing/IndexStateManager.js';
import type { FlowArtifactManager } from '../flow-artifact-manager.js';
import { metrics } from "../../utils/MetricsCollector.js";
import { extractSymbol } from "./understand/CallGraphAnalysis.js";
import { logProgress, logToolStart, logToolEnd, type ProgressState } from "../../utils/ProgressLogger.js";
import { initializeUnderstandExecution } from "./understand/UnderstandPillarExecutionSetup.js";
import { resolveUnderstandTarget } from "./understand/UnderstandPillarExecutionSearch.js";
import { collectUnderstandData } from "./understand/UnderstandPillarExecutionCollection.js";
import { buildUnderstandPacks } from "./understand/UnderstandPillarExecutionPacks.js";
import { executeUnderstandClusters } from "./understand/UnderstandPillarExecutionClusters.js";
import { finalizeUnderstandResponse } from "./understand/UnderstandPillarExecutionFinalize.js";
import type { StylePack } from "../../types/flow-artifacts.js";


export class UnderstandPillar {
  private static readonly styleCacheTtlMs =
    Number.parseInt(process.env.KAIRO_STYLE_PACK_TTL_MS ?? "1800000", 10) || 1800000;
  private static styleCache = new LRUCache<string, StylePack>({
    max: Number.parseInt(process.env.KAIRO_STYLE_PACK_CACHE_SIZE ?? "50", 10) || 50,
    ttl: UnderstandPillar.styleCacheTtlMs
  });

  constructor(private readonly registry: InternalToolRegistry) {}

  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const stopTotal = metrics.startTimer("understand.total_ms");
    const startedAt = Date.now();
    try {
    const artifactManager = this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
    const setup = await initializeUnderstandExecution({
      intent,
      context,
      registry: this.registry,
      startedAt,
      runTool: (ctx, tool, args, progress) => this.runTool(ctx, tool, args, progress),
      extractPath: (value) => this.extractPath(value ?? ""),
      extractSymbol: (value) => extractSymbol(value ?? "")
    });

    logProgress(setup.progress, `Start subject="${setup.input.subject}" depth=${setup.depth}.`);

    const searchResult = await resolveUnderstandTarget({
      setup,
      context,
      runTool: (ctx, tool, args, progress) => this.runTool(ctx, tool, args, progress),
      progress: setup.progress
    });
    if (searchResult.response) {
      return searchResult.response;
    }
    const resolution = searchResult.resolution!;
    logProgress(setup.progress, `Resolved filePath="${resolution.filePath}" symbol="${resolution.symbolName ?? ""}".`);

    const { data, state } = await collectUnderstandData({
      setup,
      context,
      runTool: (ctx, tool, args, progress) => this.runTool(ctx, tool, args, progress),
      progress: setup.progress,
      searchResult: resolution.searchResult,
      filePath: resolution.filePath,
      symbolName: resolution.symbolName,
      isDocument: resolution.isDocument,
      artifactManager
    });

    const elapsedMs = Date.now() - startedAt;
    logProgress(setup.progress, `Completed in ${elapsedMs}ms.`);

    const integrityReport = setup.input.integrityOptions && setup.input.integrityOptions.mode !== "off"
      ? (await IntegrityEngine.run(
        {
          query: setup.input.subject,
          targetPaths: data.filePath ? [data.filePath] : undefined,
          scope: setup.input.integrityOptions.scope ?? "auto",
          sources: setup.input.integrityOptions.sources ?? [],
          limits: setup.input.integrityOptions.limits ?? {},
          mode: setup.input.integrityOptions.mode ?? "warn"
        },
        (tool, args) => this.runTool(context, tool, args, setup.progress)
      )).report
      : undefined;
    const indexStateManager = this.registry.getMetadata<IndexStateManager>("indexStateManager");
    const indexSnapshot = indexStateManager ? await indexStateManager.getSnapshot().catch(() => undefined) : undefined;
    if (setup.input.resolvedSessionId) {
      const policyPatch: Partial<{ profile?: string; sources?: string; understand?: Record<string, unknown> }> = {};
      if (typeof setup.input.constraints.profile === "string") {
        policyPatch.profile = setup.input.constraints.profile;
        policyPatch.understand = { ...(policyPatch.understand ?? {}), profile: setup.input.constraints.profile };
      }
      if (typeof setup.input.constraints.sources === "string") {
        policyPatch.sources = setup.input.constraints.sources;
        policyPatch.understand = { ...(policyPatch.understand ?? {}), sources: setup.input.constraints.sources };
      }
      if (Object.keys(policyPatch).length > 0) {
        artifactManager?.updateSessionPolicy(setup.input.resolvedSessionId, policyPatch as any, "merge");
      }
    }

    const { analysisPack, stylePack } = await buildUnderstandPacks({
      setup,
      artifactManager,
      registry: this.registry,
      styleCache: UnderstandPillar.styleCache,
      styleCacheTtlMs: UnderstandPillar.styleCacheTtlMs,
      filePath: data.filePath,
      searchResults: data.searchResult?.results,
      deps: data.deps,
      hotSpots: data.hotSpots,
      analysis: setup.input.analysis,
      indexSnapshot,
      degraded: state.degraded
    });

    const graphRagClusters = await executeUnderstandClusters({
      setup,
      state,
      registry: this.registry,
      projectStats: data.projectStats,
      isDocument: data.isDocument
    });

    const response = finalizeUnderstandResponse({
      setup,
      state,
      data,
      integrityReport,
      indexSnapshot,
      analysisPack,
      stylePack,
      graphRagClusters
    });

    setup.adaptiveLod?.recordOutcome({
      sessionId: setup.input.resolvedSessionId,
      tool: "understand",
      success: Boolean(response.success),
      degradedReasons: response.degradedReasonDetails
    });
    return response;
    } finally {
      stopTotal();
    }
  }

  private extractPath(text: string): string | null {
    if (!text) return null;
    const pathPattern = /([A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|json|md|mdx))/i;
    const match = text.match(pathPattern);
    if (match) return match[1];
    if (/\s/.test(text)) {
      const tokens = text.split(/\s+/).map(token =>
        token.replace(/^[\"'`(]+/, "").replace(/[\"'`),.;]+$/, "")
      );
      for (const token of tokens) {
        if (!token) continue;
        if (pathPattern.test(token)) {
          return token;
        }
        if (/[\\/]/.test(token) && /\.[a-z0-9]+$/i.test(token)) {
          return token;
        }
      }
      return null;
    }
    if (/[\\/]/.test(text) && /\.[a-z0-9]+$/i.test(text.trim())) {
      return text.trim();
    }
    return null;
  }

  private async runTool(
    context: OrchestrationContext,
    tool: string,
    args: any,
    progress?: ProgressState
  ) {
    const started = logToolStart(progress, tool);
    const output = await this.registry.execute(tool, args);
    const duration = Date.now() - started;
    logToolEnd(progress, tool, started);
    context.addStep({
      id: `${tool}_${context.getFullHistory().length + 1}`,
      tool,
      args,
      output,
      status: output?.success === false || output?.isError ? 'failure' : 'success',
      duration
    });
    return output;
  }
}
