
import path from "path";
import { LRUCache } from "lru-cache";
import { InternalToolRegistry } from '../InternalToolRegistry.js';
import { OrchestrationContext } from '../OrchestrationContext.js';
import { ParsedIntent } from '../IntentRouter.js';
import { BudgetManager } from '../BudgetManager.js';
import { analyzeQuery, isStrongQuery } from '../../engine/search/QueryMetrics.js';
import { IntegrityEngine } from '../../integrity/IntegrityEngine.js';
import { UnifiedContextGraph } from '../context/UnifiedContextGraph.js';
import type { IndexStateManager } from '../../indexing/IndexStateManager.js';
import type { AnalysisPack, StylePack } from '../../types/flow-artifacts.js';
import { VibeProfileBuilder } from '../../generation/vibe-profile-builder.js';
import { AnalysisPackBuilder } from '../../generation/analysis-pack-builder.js';
import type { FlowArtifactManager } from '../flow-artifact-manager.js';
import { extractSymbol, fetchCallGraph } from './understand/CallGraphAnalysis.js';
import {
  categorizeDocLinks,
  collectDependenciesFromGraph,
  isDocumentPath,
  mergeRelatedCode,
  resolveCodeReferences,
  resolveMentionReferences
} from './understand/DependencyAnalysis.js';
import { buildUnderstandResponse } from './understand/ReportGenerator.js';
import { resolveProgressState, logProgress, logToolStart, logToolEnd, ProgressState } from '../../utils/ProgressLogger.js';
import { checkSkeletonSupport } from '../../ast/LanguageSupportSignals.js';
import { buildDegradedReasons } from '../DegradedReasonMapper.js';
import { UniversalFallbackExtractor } from '../../ast/extraction/UniversalFallbackExtractor.js';
import { AstManager } from '../../ast/AstManager.js';
import { applyTokenBudget } from '../TokenBudget.js';
import { normalizeUnderstandInput } from './understand/UnderstandInputNormalizer.js';
import type { OptionSource, TraceOptionResolution } from '../../types/option-trace.js';
import { TraceBuilder } from '../trace/TraceBuilder.js';
import { buildBudgetPlan, getSectionPlan } from '../budget/TokenBudgetAllocatorV2.js';
import { FeatureFlags } from "../../config/FeatureFlags.js";
import { metrics } from "../../utils/MetricsCollector.js";
import type { ToolProfile } from '../options/OptionResolver.js';
import { AdaptiveLodController } from "../adaptive-flow/AdaptiveLodController.js";
import {
  computeAdaptiveFlowGate,
  recordAdaptiveFlowGateTrace,
  resolveRolloutPresetFromEnv,
  setAdaptiveFlowGate
} from "../adaptive-flow/AdaptiveFlowGate.js";
import {
  applySkeletonCompressionDecision,
  resolveAllowGraphs,
  shouldBuildFallbackGraph
} from "./understand/UnderstandDecisionEngine.js";

const resolveOptionSource = (explicit: boolean, hasSession: boolean): OptionSource => {
  if (explicit) return "explicit";
  if (hasSession) return "session";
  return "default";
};

const buildStringResolution = (
  resolved: string | undefined,
  explicit: boolean,
  hasSession: boolean,
  requested?: unknown
): TraceOptionResolution<string | null> => ({
  source: resolveOptionSource(explicit, hasSession),
  explicit,
  resolved: resolved ?? null,
  ...(requested !== undefined ? { requested } : {})
});


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
    try {
    const artifactManager = this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
    const {
      constraints,
      subject,
      resolvedSessionId,
      sessionPolicy,
      resolvedOptions,
      depth: resolvedDepth,
      include: resolvedInclude,
      traceEnabled,
      vibe,
      wantsVibe,
      analysis,
      wantsAnalysis,
      includeDependencies,
      includeCalls,
      explicitPath,
      symbolHint,
      integrityOptions,
      limits,
      maxTokens: resolvedMaxTokens
    } = normalizeUnderstandInput(intent, {
      resolveSessionId: (rawSessionId, fallback) => artifactManager?.resolveSessionId(rawSessionId, fallback),
      getSessionPolicy: (sessionId) => (sessionId ? artifactManager?.getSession(sessionId)?.policy : undefined),
      extractPath: (value) => this.extractPath(value ?? ""),
      extractSymbol: (value) => extractSymbol(value ?? "")
    });
    let depth = resolvedDepth;
    const include = resolvedInclude;
    let maxTokens = resolvedMaxTokens;
    let profile: ToolProfile | undefined = resolvedOptions.effective.profile as ToolProfile | undefined;
    const adaptiveLod = this.registry.getMetadata<AdaptiveLodController>("adaptiveLodController");
    const profileExplicit = typeof constraints.profile === "string";
    const adaptiveDecision = adaptiveLod?.resolveProfile({
      sessionId: resolvedSessionId,
      tool: "understand",
      requestedProfile: profile ?? "balanced",
      explicit: profileExplicit
    });
    if (adaptiveDecision?.downshifted) {
      profile = adaptiveDecision.profile;
      if (!profileExplicit && typeof constraints.depth !== "string") {
        if (profile === "lean" || profile === "fast") depth = "shallow";
        if (profile === "deep") depth = "deep";
      }
      if (profile === "lean") {
        if (typeof limits.maxTokens !== "number") limits.maxTokens = 1600;
        if (typeof limits.timeoutMs !== "number") limits.timeoutMs = 4000;
        maxTokens = 1600;
      }
      if (profile === "fast" && typeof limits.maxTokens !== "number") {
        maxTokens = maxTokens ?? 1600;
      }
    }
    resolvedOptions.effective.profile = profile;
    let resolvedPath = explicitPath ?? null;
    const progress = resolveProgressState('Understand', constraints);
    const startedAt = Date.now();
    const sessionProfile = sessionPolicy?.understand?.profile ?? sessionPolicy?.profile;
    const sessionSources = sessionPolicy?.understand?.sources ?? sessionPolicy?.sources;
    const traceBuilder = traceEnabled
      ? new TraceBuilder(
        "understand",
        {
          profile: buildStringResolution(
            profile,
            typeof constraints.profile === "string",
            Boolean(sessionProfile),
            typeof constraints.profile === "string" ? constraints.profile : undefined
          ),
          sources: buildStringResolution(
            resolvedOptions.effective.sources,
            typeof constraints.sources === "string",
            Boolean(sessionSources),
            typeof constraints.sources === "string" ? constraints.sources : undefined
          ),
          trace: {
            source: constraints.trace === true ? "explicit" : "default",
            explicit: constraints.trace === true,
            resolved: traceEnabled
          }
        },
        { startedAtMs: startedAt }
      )
      : undefined;
    if (traceBuilder) {
      traceBuilder.setBudget({ maxTokens });
    }
    if (traceBuilder && adaptiveDecision?.downshifted) {
      traceBuilder.recordEvent({
        area: "budget",
        code: "adaptive_lod.downshift",
        data: {
          from: resolvedOptions.effective.profile ?? "balanced",
          to: profile,
          violationStreak: adaptiveDecision.violationStreak,
          stableScore: adaptiveDecision.stableScore,
          cooldownRemaining: adaptiveDecision.cooldownRemaining,
          reasonCodes: adaptiveDecision.reasonCodes
        }
      });
    }
    const budgetPlan = buildBudgetPlan({
      pillar: "understand",
      profile: (profile ?? "balanced") as ToolProfile,
      sources: resolvedOptions.effective.sources,
      maxTokens
    });
    let includeCallsPlanned = includeCalls;
    let includeDependenciesPlanned = includeDependencies;
    let includeHotSpotsPlanned = include.hotSpots === true;
    let wantsVibePlanned = wantsVibe;
    let wantsAnalysisPlanned = wantsAnalysis;
    const relatedCodePlan = getSectionPlan(budgetPlan, "related_code");
    const analysisPlan = getSectionPlan(budgetPlan, "analysis_pack");
    const stylePlan = getSectionPlan(budgetPlan, "style_pack");
    const relatedCodeLimit = relatedCodePlan?.strategy === "summary"
      ? 1
      : (relatedCodePlan?.strategy === "preview" ? 3 : undefined);
    const budgetOmissions: Array<"dependencies" | "call_graph" | "hot_spots" | "analysis_pack" | "style_pack"> = [];

    const recordAllocatorEvents = () => {
      if (!traceBuilder) return;
      traceBuilder.recordEvent({
        area: "budget",
        code: "allocator.plan_created",
        data: {
          maxTokens: budgetPlan.maxTokens,
          maxChars: budgetPlan.maxChars,
          sectionCount: budgetPlan.sections.length
        }
      });
      for (const section of budgetPlan.sections) {
        traceBuilder.recordEvent({
          area: "budget",
          code: "allocator.section_strategy",
          data: {
            section: section.section,
            strategy: section.strategy,
            tokens: section.tokens,
            chars: section.chars
          }
        });
        if (section.strategy === "omit") {
          traceBuilder.recordSkip(section.section, "budget_exceeded", "allocator omitted section");
        }
      }
    };

    const applyBudgetOmit = (section: "dependencies" | "call_graph" | "hot_spots" | "analysis_pack" | "style_pack") => {
      budgetOmissions.push(section);
      if (section === "dependencies") includeDependenciesPlanned = false;
      if (section === "call_graph") includeCallsPlanned = false;
      if (section === "hot_spots") includeHotSpotsPlanned = false;
      if (section === "analysis_pack") wantsAnalysisPlanned = false;
      if (section === "style_pack") wantsVibePlanned = false;
    };

    for (const entry of budgetPlan.sections) {
      if (entry.strategy !== "omit") continue;
      if (entry.section === "dependencies") applyBudgetOmit("dependencies");
      if (entry.section === "call_graph") applyBudgetOmit("call_graph");
      if (entry.section === "hot_spots") applyBudgetOmit("hot_spots");
      if (entry.section === "analysis_pack") applyBudgetOmit("analysis_pack");
      if (entry.section === "style_pack") applyBudgetOmit("style_pack");
    }
    recordAllocatorEvents();

    const metrics = analyzeQuery(subject);
    let initialProjectStats = context.getState<any>("project_profile");
    if (!initialProjectStats) {
      try {
        initialProjectStats = await this.runTool(context, "project_profile", {}, progress);
        if (initialProjectStats) {
          context.setState("project_profile", initialProjectStats);
        }
      } catch {
        initialProjectStats = undefined;
      }
    }
    const initialBudget = BudgetManager.create({
      category: 'understand',
      queryLength: metrics.length,
      tokenCount: metrics.tokenCount,
      strongQuery: metrics.strong,
      includeGraph: includeDependenciesPlanned || includeCallsPlanned,
      includeHotSpots: includeHotSpotsPlanned,
      projectStats: initialProjectStats?.fileCount ? { fileCount: initialProjectStats.fileCount } : undefined
    });
    const searchBudget = this.resolveSearchBudget(constraints, subject, initialBudget);

    const gate = computeAdaptiveFlowGate({
      profile,
      fileCount: typeof initialProjectStats?.fileCount === "number" ? initialProjectStats.fileCount : undefined
    });
    setAdaptiveFlowGate(context, gate);
    if (traceBuilder) {
      recordAdaptiveFlowGateTrace(traceBuilder, gate, {
        rolloutMode: resolveRolloutPresetFromEnv() ?? FeatureFlags.getMode(FeatureFlags.ADAPTIVE_FLOW_ENABLED),
        userIdResolved: Boolean(FeatureFlags.getContext()?.userId)
      });
    }

    logProgress(progress, `Start subject="${subject}" depth=${depth}.`);
    const ucg = context.getState<UnifiedContextGraph>('ucg');
    const runTool = (ctx: OrchestrationContext, tool: string, args: any, progressArg?: ProgressState) =>
      this.runTool(ctx, tool, args, progressArg);

    // 1. 초기 검색 수행
    let searchResult = { results: [] as any[] };
    if (explicitPath && !/[\\/]/.test(explicitPath)) {
      const fileMatches = await this.runTool(context, 'project_search', {
        query: explicitPath,
        type: 'filename',
        maxResults: 5
      }, progress);
      if (fileMatches?.results?.length) {
        resolvedPath = fileMatches.results[0].path;
      }
    }

    if (!resolvedPath) {
      const searchMaxResults = typeof constraints.limit === 'number' && Number.isFinite(constraints.limit) && constraints.limit > 0
        ? constraints.limit
        : 5;
      searchResult = await this.runSearch(context, {
        query: subject,
        symbolHint,
        scope: constraints.scope,
        maxResults: searchMaxResults,
        budget: searchBudget
      }, progress);
    }

    if ((!searchResult.results || searchResult.results.length === 0) && !resolvedPath) {
      return { success: false, status: 'no_results', summary: 'No relevant code found.', results: [] };
    }

    const primaryResult = resolvedPath ? { path: resolvedPath } : searchResult.results[0];
    let filePath = primaryResult.path;
    let symbolName = primaryResult?.symbol?.name;
    if (includeCallsPlanned && !symbolName && symbolHint) {
      const symbolMatches = await this.runTool(context, 'project_search', {
        query: symbolHint,
        type: 'symbol',
        maxResults: 10
      }, progress);
      const match = symbolMatches?.results?.find((result: any) => result.path === filePath) ?? symbolMatches?.results?.[0];
      if (match?.symbol?.name) {
        symbolName = match.symbol.name;
        if (!resolvedPath && match?.path) {
          filePath = match.path;
        }
      }
    }

    if (traceBuilder && includeCallsPlanned && !symbolName) {
      traceBuilder.recordSkip("call_graph", "not_applicable", "symbol not resolved");
    }

    logProgress(progress, `Resolved filePath="${filePath}" symbol="${symbolName ?? ''}".`);

    const isDocument = isDocumentPath(filePath);
    if (traceBuilder && isDocument) {
      if (includeCallsPlanned) {
        traceBuilder.recordSkip("call_graph", "unsupported", "document targets skip call graph");
      }
      if (includeDependenciesPlanned) {
        traceBuilder.recordSkip("dependencies", "unsupported", "document targets skip dependencies");
      }
      if (includeHotSpotsPlanned) {
        traceBuilder.recordSkip("hot_spots", "unsupported", "document targets skip hotspots");
      }
    }
    let projectStats: any = undefined;
    try {
      projectStats = await this.runTool(context, 'project_profile', {}, progress);
    } catch {
      projectStats = undefined;
    }
    const budget = BudgetManager.create({
      category: 'understand',
      queryLength: metrics.length,
      tokenCount: metrics.tokenCount,
      strongQuery: metrics.strong,
      includeGraph: includeDependenciesPlanned || includeCallsPlanned,
      includeHotSpots: includeHotSpotsPlanned,
      projectStats: { fileCount: projectStats?.fileCount }
    });

    // 2. Staged Data Collection (Budget-Aware)
    let skeleton: any = '';
    let docProfile: any = undefined;
    let docReferences: any = undefined;
    let relatedCode: any[] | undefined = undefined;
    let mentionMatches: any[] | undefined = undefined;
    let degraded = false;
    const degradedReasons: string[] = [];
    let fallbackGraph: { mode: "l2"; edges: Array<{ from: string; to: string; confidence: "low"; reason?: string }>; evidence?: string[] } | undefined = undefined;
    let refinementReason: string | undefined = undefined;
    if (budgetOmissions.length > 0) {
      degraded = true;
      if (!degradedReasons.includes("budget_exceeded")) {
        degradedReasons.push("budget_exceeded");
      }
      refinementReason = refinementReason ?? "budget_exceeded";
      if (traceBuilder) {
        for (const section of budgetOmissions) {
          traceBuilder.recordEvent({
            area: "budget",
            code: "allocator.section_omit",
            data: { section }
          });
        }
      }
    }
    if (isDocument) {
      const docAnalysis = await this.runTool(context, 'document_analyze', { filePath }, progress);
      skeleton = docAnalysis?.skeleton ?? '';
      docProfile = docAnalysis?.profile;
      if (docProfile?.links?.length) {
        docReferences = categorizeDocLinks(docProfile.links);
        relatedCode = await resolveCodeReferences(context, docReferences.code ?? [], runTool, progress);
      }
      if (Array.isArray(docProfile?.mentions) && docProfile.mentions.length > 0) {
        mentionMatches = await resolveMentionReferences(context, docProfile.mentions, runTool, progress);
        relatedCode = mergeRelatedCode(relatedCode, mentionMatches);
      }
      if (relatedCodeLimit && Array.isArray(relatedCode) && relatedCode.length > relatedCodeLimit) {
        relatedCode = relatedCode.slice(0, relatedCodeLimit);
        degraded = true;
        if (!degradedReasons.includes("budget_exceeded")) {
          degradedReasons.push("budget_exceeded");
        }
        refinementReason = refinementReason ?? "budget_exceeded";
        if (traceBuilder) {
          traceBuilder.recordEvent({
            area: "budget",
            code: "allocator.section_omit",
            data: { section: "related_code" }
          });
        }
      }
    } else {
      const support = await checkSkeletonSupport(filePath);
      if (support.degraded && support.reason) {
        degraded = true;
        degradedReasons.push(support.reason);
      }
      skeleton = await this.runTool(context, 'code_read', { filePath, view: 'skeleton' }, progress);
    }
    const fileProfile = await this.runTool(context, 'file_profile', { filePath }, progress);

    let calls: any = null;
    let deps: any = null;
    let hotSpots: any = [];

    const allowGraphs = resolveAllowGraphs({
      isDocument,
      strongQuery: isStrongQuery(metrics),
      budgetProfile: budget.profile,
      includeCalls: includeCallsPlanned,
      includeDependencies: includeDependenciesPlanned,
      includeHotSpots: includeHotSpotsPlanned
    });
    if (isDocument && (includeCallsPlanned || includeDependenciesPlanned || includeHotSpotsPlanned)) {
      degraded = true;
      refinementReason = refinementReason ?? 'document_file';
    }
    if (includeCallsPlanned && symbolName && allowGraphs) {
      calls = await fetchCallGraph({
        context,
        filePath,
        symbolName,
        depth,
        runTool,
        progress
      });
    } else if (includeCallsPlanned && symbolName && !allowGraphs) {
      degraded = true;
      refinementReason = refinementReason ?? 'budget_exceeded';
      if (traceBuilder) {
        traceBuilder.recordSkip("call_graph", "budget_exceeded", "graph budget gated");
      }
    }

    if (includeDependenciesPlanned && allowGraphs) {
      deps = await collectDependenciesFromGraph(ucg, filePath, context);

      if (!deps || !Array.isArray(deps.edges) || deps.edges.length === 0) {
        // Fallback to legacy tool if shared graph is unavailable or cold
        deps = await this.runTool(context, 'relationship_analyze', {
          target: filePath,
          mode: 'dependencies',
          direction: 'both'
        }, progress);
      }
    } else if (includeDependenciesPlanned && !allowGraphs) {
      degraded = true;
      refinementReason = refinementReason ?? 'budget_exceeded';
      if (traceBuilder) {
        traceBuilder.recordSkip("dependencies", "budget_exceeded", "graph budget gated");
      }
    }

    if (includeHotSpotsPlanned && allowGraphs) {
      hotSpots = await this.runTool(context, 'hotspot_detect', {}, progress);
    } else if (includeHotSpotsPlanned && !allowGraphs) {
      degraded = true;
      refinementReason = refinementReason ?? 'budget_exceeded';
      if (traceBuilder) {
        traceBuilder.recordSkip("hot_spots", "budget_exceeded", "graph budget gated");
      }
    }

    if (!isDocument && shouldBuildFallbackGraph(degradedReasons)) {
      fallbackGraph = await this.buildFallbackGraph(filePath);
      if (traceBuilder) {
        traceBuilder.recordEvent({
          area: "capabilities",
          code: "fallback_graph",
          message: "Using fallback graph extraction",
          data: { filePathHint: path.basename(filePath) }
        });
      }
    }

    const compressionDecision = applySkeletonCompressionDecision({
      skeleton: typeof skeleton === "string" ? skeleton : String(skeleton ?? ""),
      filePath,
      maxTokens,
      languageId: AstManager.getInstance().getLanguageId(filePath),
      buildDigest: () => this.buildSkeletonDigest(profile),
      applyTokenBudget
    });
    skeleton = compressionDecision.skeleton;
    if (compressionDecision.degraded) {
      degraded = true;
      if (compressionDecision.degradedReason && !degradedReasons.includes(compressionDecision.degradedReason)) {
        degradedReasons.push(compressionDecision.degradedReason);
      }
    }


        // 3. Synthesize Response (Advanced synthesis in Phase 3)
    const status = includeCallsPlanned && !symbolName ? 'partial_success' : (degraded ? 'partial_success' : 'ok');
    const elapsedMs = Date.now() - startedAt;
    logProgress(progress, `Completed in ${elapsedMs}ms.`);
    const integrityReport = integrityOptions && integrityOptions.mode !== "off"
      ? (await IntegrityEngine.run(
          {
            query: subject,
            targetPaths: filePath ? [filePath] : undefined,
            scope: integrityOptions.scope ?? "auto",
            sources: integrityOptions.sources ?? [],
            limits: integrityOptions.limits ?? {},
            mode: integrityOptions.mode ?? "warn"
          },
          (tool, args) => this.runTool(context, tool, args, progress)
        )).report
      : undefined;
    const indexStateManager = this.registry.getMetadata<IndexStateManager>("indexStateManager");
    const indexSnapshot = indexStateManager ? await indexStateManager.getSnapshot().catch(() => undefined) : undefined;
    if (resolvedSessionId) {
      const policyPatch: Partial<{ profile?: string; sources?: string; understand?: Record<string, unknown> }> = {};
      if (typeof constraints.profile === "string") {
        policyPatch.profile = constraints.profile;
        policyPatch.understand = { ...(policyPatch.understand ?? {}), profile: constraints.profile };
      }
      if (typeof constraints.sources === "string") {
        policyPatch.sources = constraints.sources;
        policyPatch.understand = { ...(policyPatch.understand ?? {}), sources: constraints.sources };
      }
      if (Object.keys(policyPatch).length > 0) {
        artifactManager?.updateSessionPolicy(resolvedSessionId, policyPatch as any, "merge");
      }
    }

    let analysisPack: AnalysisPack | undefined;
    if (wantsAnalysisPlanned) {
      if (analysisPlan?.strategy === "summary" && resolvedSessionId && artifactManager) {
        analysisPack = artifactManager.getLatestAnalysisPack(resolvedSessionId);
        if (analysisPack && traceBuilder) {
          traceBuilder.recordEvent({
            area: "budget",
            code: "allocator.reuse_pack",
            data: { section: "analysis_pack" }
          });
        }
      }
      if (!analysisPack) {
        analysisPack = this.buildAnalysisPack({
          goal: subject,
          primaryFile: filePath,
          searchResults: searchResult?.results,
          dependencyEdges: deps?.edges,
          hotSpots,
          degraded,
          analysis
        });
      }
    }

    if (analysisPack) {
      if (artifactManager) {
        artifactManager.store({
          id: analysisPack.id,
          type: "analysis",
          createdAt: analysisPack.createdAt,
          pack: analysisPack,
          sessionId: resolvedSessionId,
          metadata: { intent: subject }
        });
      }
    }

    let stylePack: StylePack | undefined;
    if (wantsVibePlanned) {
      if (stylePlan?.strategy === "summary" && resolvedSessionId && artifactManager) {
        stylePack = artifactManager.getLatestStylePack(resolvedSessionId);
        if (stylePack && traceBuilder) {
          traceBuilder.recordEvent({
            area: "budget",
            code: "allocator.reuse_pack",
            data: { section: "style_pack" }
          });
        }
      }
      if (!stylePack) {
        stylePack = await this.buildStylePack(filePath, vibe, indexSnapshot, resolvedSessionId, subject);
      }
    }

    const response = buildUnderstandResponse({
      subject,
      filePath,
      symbolName,
      skeleton,
      profile,
      isDocument,
      docProfile,
      docReferences,
      relatedCode,
      calls,
      deps,
      hotSpots,
      integrityReport,
      includeCalls: includeCallsPlanned,
      degraded,
      degradedReasons: degradedReasons.length > 0 ? degradedReasons : undefined,
      degradedReasonDetails: buildDegradedReasons(degradedReasons),
      fallbackGraph,
      refinementReason,
      budget,
      allowGraphs,
      indexSnapshot,
      stylePack,
      analysisPack,
      sessionId: resolvedSessionId,
      compression: compressionDecision.compression
    });
    if (traceEnabled) {
      response.effectiveOptions = {
        version: 1,
        pillar: "understand",
        profile,
        sources: resolvedOptions.effective.sources,
        depth,
        include
      };
      if (traceBuilder) {
        traceBuilder.setBudget({
          maxTokens,
          compressionApplied: compressionDecision.compression?.applied,
          compressionMode: compressionDecision.compression?.mode
        });
        response.decisionTrace = traceBuilder.finalize();
      }
    }
    adaptiveLod?.recordOutcome({
      sessionId: resolvedSessionId,
      tool: "understand",
      success: Boolean(response.success),
      degradedReasons: response.degradedReasonDetails
    });
    return response;
    } finally {
      stopTotal();
    }
  }

  private async buildStylePack(
    filePath: string,
    vibe: { scope?: string; includeNorms?: boolean } | undefined,
    indexSnapshot?: { epoch?: number; dirtyFileCount?: number },
    sessionId?: string,
    intent?: string
  ): Promise<StylePack | undefined> {
    const cacheKey = this.getStyleCacheKey(vibe, indexSnapshot);
    if (cacheKey) {
      const cached = UnderstandPillar.styleCache.get(cacheKey);
      if (cached) {
        if (sessionId) {
          const derived: StylePack = {
            ...cached,
            id: this.generateStylePackId(),
            createdAt: Date.now(),
            expiresAt: Date.now() + UnderstandPillar.styleCacheTtlMs
          };
          const artifactManager = this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
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
    const artifactManager = this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
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
      UnderstandPillar.styleCache.set(cacheKey, pack);
    }
    return pack;
  }

  private buildSkeletonDigest(profile: any): string | undefined {
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

  private buildAnalysisPack(input: {
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

  private getStyleCacheKey(
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

  private generateStylePackId(): string {
    const suffix = Math.random().toString(36).slice(2, 8);
    return `style_${Date.now().toString(36)}_${suffix}`;
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

  private resolveSearchBudget(
    constraints: any,
    query: string,
    budget?: ReturnType<typeof BudgetManager.create>
  ): ReturnType<typeof BudgetManager.create> | undefined {
    if (!budget) return undefined;
    const timeoutMs = Number.isFinite(constraints?.limits?.timeoutMs)
      ? constraints.limits.timeoutMs
      : undefined;
    if (!timeoutMs || timeoutMs <= 0) {
      return budget;
    }
    return {
      ...budget,
      maxParseTimeMs: Math.min(budget.maxParseTimeMs, timeoutMs)
    };
  }

  private async buildFallbackGraph(
    filePath: string
  ): Promise<{ mode: "l2"; edges: Array<{ from: string; to: string; confidence: "low"; reason?: string }>; evidence?: string[] } | undefined> {
    let content = "";
    try {
      const full = await this.runTool(new OrchestrationContext(), 'code_read', { filePath, view: 'full' });
      content = typeof full === "string" ? full : (full?.content ?? "");
    } catch {
      content = "";
    }
    if (!content) return undefined;

    const languageId = AstManager.getInstance().getLanguageId(filePath);
    const extractor = new UniversalFallbackExtractor();
    const imports = extractor.extractImports(content, languageId);
    if (!imports || imports.length === 0) {
      return undefined;
    }

    const edges = imports.map((entry) => ({
      from: filePath,
      to: entry.source ?? entry.name,
      confidence: "low" as const,
      reason: "regex_imports"
    }));

    return {
      mode: "l2",
      edges,
      evidence: ["regex_imports"]
    };
  }

  private async runSearch(
    context: OrchestrationContext,
    args: { query: string; symbolHint?: string | null; scope?: string; maxResults: number; budget?: ReturnType<typeof BudgetManager.create> },
    progress?: ProgressState
  ): Promise<any> {
    const attempts: Array<{ type: "filename" | "symbol" | "file" }> = [];
    attempts.push({ type: "filename" });
    if (args.symbolHint) {
      attempts.push({ type: "symbol" });
    } else if (args.scope !== "project") {
      attempts.push({ type: "symbol" });
    }
    attempts.push({ type: "file" });

    for (const attempt of attempts) {
      const result = await this.runTool(context, "project_search", {
        query: args.query,
        type: attempt.type,
        maxResults: args.maxResults,
        budget: attempt.type === "file" ? args.budget : undefined
      }, progress);
      const filtered = this.filterSearchResults(result);
      if (filtered?.results?.length) {
        return filtered;
      }
    }

    return { results: [] };
  }

  private filterSearchResults(result: any): any {
    if (!result?.results?.length) {
      return result;
    }
    const filteredResults = result.results.filter((entry: any) => {
      const rawPath = typeof entry?.path === "string" ? entry.path : "";
      if (!rawPath) return false;
      const normalized = rawPath.replace(/\\/g, "/");
      return !normalized.includes("/.kairo/")
        && !normalized.startsWith(".kairo/")
        && !normalized.includes("/.mcp/")
        && !normalized.startsWith(".mcp/")
        && !normalized.includes("/node_modules/")
        && !normalized.startsWith("node_modules/")
        && !normalized.includes("/dist/")
        && !normalized.startsWith("dist/")
        && !normalized.includes("/coverage/")
        && !normalized.startsWith("coverage/");
    });

    return { ...result, results: filteredResults };
  }

  private looksLikePath(query: string): boolean {
    if (!query) return false;
    if (/[\\/]/.test(query)) return true;
    return /\.[a-z0-9]+$/i.test(query.trim());
  }
}
