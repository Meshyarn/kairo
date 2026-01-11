
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
import { OptionResolver } from '../options/OptionResolver.js';
import { checkSkeletonSupport } from '../../ast/LanguageSupportSignals.js';
import { buildDegradedReasons } from '../DegradedReasonMapper.js';
import { UniversalFallbackExtractor } from '../../ast/extraction/UniversalFallbackExtractor.js';
import { AstManager } from '../../ast/AstManager.js';
import { applyTokenBudget } from '../TokenBudget.js';


export class UnderstandPillar {
  private static readonly styleCacheTtlMs =
    Number.parseInt(process.env.KAIRO_STYLE_PACK_TTL_MS ?? "1800000", 10) || 1800000;
  private static styleCache = new LRUCache<string, StylePack>({
    max: Number.parseInt(process.env.KAIRO_STYLE_PACK_CACHE_SIZE ?? "50", 10) || 50,
    ttl: UnderstandPillar.styleCacheTtlMs
  });

  constructor(private readonly registry: InternalToolRegistry) {}

  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const { targets, constraints, originalIntent } = intent;
    const subject = constraints.goal || targets[0] || originalIntent;
    const rawSessionId = typeof constraints.sessionId === "string" ? constraints.sessionId : undefined;
    const artifactManager = this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
    const resolvedSessionId = artifactManager?.resolveSessionId(rawSessionId, subject);
    const sessionPolicy = resolvedSessionId ? artifactManager?.getSession(resolvedSessionId)?.policy : undefined;
    const resolvedOptions = OptionResolver.resolveUnderstandOptions(constraints, sessionPolicy);
    const depth = resolvedOptions.effective.depth || 'standard';
    const include = resolvedOptions.effective.include ?? {};
    const traceEnabled = resolvedOptions.effective.traceEnabled;
    const vibe = constraints.vibe as { extract?: boolean; scope?: string; includeNorms?: boolean } | undefined;
    const wantsVibe = vibe?.extract === true;
    const analysis = constraints.analysis as { clusters?: boolean; maxClusters?: number; maxFilesPerCluster?: number } | undefined;
    const wantsAnalysis = analysis?.clusters === true;
    const includeDependencies = include.dependencies === true || include.pageRank === true;
    const includeCalls = include.callGraph === true;
    const explicitPath = this.extractPath(subject) ?? (typeof originalIntent === 'string' ? this.extractPath(originalIntent) : null);
    const symbolHint = extractSymbol(subject) ?? (typeof originalIntent === 'string' ? extractSymbol(originalIntent) : null);
    let resolvedPath = explicitPath;
    const progress = resolveProgressState('Understand', constraints);
    const startedAt = Date.now();
    const integrityOptions = IntegrityEngine.resolveOptions(constraints.integrity, "understand");
    const envMaxTokens = Number.parseInt(process.env.KAIRO_UNDERSTAND_MAX_TOKENS ?? process.env.KAIRO_DEFAULT_MAX_TOKENS ?? "", 10);
    const limits = constraints.limits ?? {};
    const maxTokens = Number.isFinite(limits.maxTokens) && limits.maxTokens! > 0
      ? limits.maxTokens
      : (Number.isFinite(envMaxTokens) && envMaxTokens > 0 ? envMaxTokens : undefined);

    const metrics = analyzeQuery(subject);
    const initialProjectStats = context.getState<any>("project_profile");
    const initialBudget = BudgetManager.create({
      category: 'understand',
      queryLength: metrics.length,
      tokenCount: metrics.tokenCount,
      strongQuery: metrics.strong,
      includeGraph: includeDependencies || includeCalls,
      includeHotSpots: include.hotSpots,
      projectStats: initialProjectStats?.fileCount ? { fileCount: initialProjectStats.fileCount } : undefined
    });
    const searchBudget = this.resolveSearchBudget(constraints, subject, initialBudget);

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
    if (includeCalls && !symbolName && symbolHint) {
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

    logProgress(progress, `Resolved filePath="${filePath}" symbol="${symbolName ?? ''}".`);

    const isDocument = isDocumentPath(filePath);
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
      includeGraph: includeDependencies || includeCalls,
      includeHotSpots: include.hotSpots,
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
    } else {
      const support = await checkSkeletonSupport(filePath);
      if (support.degraded && support.reason) {
        degraded = true;
        degradedReasons.push(support.reason);
      }
      skeleton = await this.runTool(context, 'code_read', { filePath, view: 'skeleton' }, progress);
    }
    const profile = await this.runTool(context, 'file_profile', { filePath }, progress);

    let calls: any = null;
    let deps: any = null;
    let hotSpots: any = [];

    const allowGraphs = !isDocument && isStrongQuery(metrics) && (budget.profile !== 'safe' || includeCalls || includeDependencies || include.hotSpots === true);
    if (isDocument && (includeCalls || includeDependencies || include.hotSpots === true)) {
      degraded = true;
      refinementReason = refinementReason ?? 'document_file';
    }
    if (includeCalls && symbolName && allowGraphs) {
      calls = await fetchCallGraph({
        context,
        filePath,
        symbolName,
        depth,
        runTool,
        progress
      });
    } else if (includeCalls && symbolName && !allowGraphs) {
      degraded = true;
      refinementReason = refinementReason ?? 'budget_exceeded';
    }

    if (includeDependencies && allowGraphs) {
      deps = await collectDependenciesFromGraph(ucg, filePath);

      if (!deps || !Array.isArray(deps.edges) || deps.edges.length === 0) {
        // Fallback to legacy tool if shared graph is unavailable or cold
        deps = await this.runTool(context, 'relationship_analyze', {
          target: filePath,
          mode: 'dependencies',
          direction: 'both'
        }, progress);
      }
    } else if (includeDependencies && !allowGraphs) {
      degraded = true;
      refinementReason = refinementReason ?? 'budget_exceeded';
    }

    if (include.hotSpots === true && allowGraphs) {
      hotSpots = await this.runTool(context, 'hotspot_detect', {}, progress);
    } else if (include.hotSpots === true && !allowGraphs) {
      degraded = true;
      refinementReason = refinementReason ?? 'budget_exceeded';
    }

    if (!isDocument && this.shouldBuildFallbackGraph(degradedReasons)) {
      fallbackGraph = await this.buildFallbackGraph(filePath);
    }

    const compression = applyTokenBudget(typeof skeleton === "string" ? skeleton : String(skeleton ?? ""), {
      maxTokens,
      maxChars: undefined,
      languageId: AstManager.getInstance().getLanguageId(filePath)
    });
    if (compression.applied && typeof skeleton === "string") {
      skeleton = compression.text;
      degraded = true;
      degradedReasons.push("budget_exceeded");
    }


        // 3. Synthesize Response (Advanced synthesis in Phase 3)
    const status = includeCalls && !symbolName ? 'partial_success' : (degraded ? 'partial_success' : 'ok');
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

    const analysisPack = wantsAnalysis
      ? this.buildAnalysisPack({
          goal: subject,
          primaryFile: filePath,
          searchResults: searchResult?.results,
          dependencyEdges: deps?.edges,
          hotSpots,
          degraded,
          analysis
        })
      : undefined;

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
      includeCalls,
      degraded,
      degradedReasons: degradedReasons.length > 0 ? degradedReasons : undefined,
      degradedReasonDetails: buildDegradedReasons(degradedReasons),
      fallbackGraph,
      refinementReason,
      budget,
      allowGraphs,
      indexSnapshot,
      stylePack: wantsVibe ? await this.buildStylePack(filePath, vibe, indexSnapshot, resolvedSessionId, subject) : undefined,
      analysisPack,
      sessionId: resolvedSessionId,
      compression: compression.applied
        ? {
            applied: true,
            mode: "distill",
            elasticWindowPct: compression.elasticWindowPct,
            maxTokens: compression.maxTokens,
            estimatedTokens: compression.estimatedTokens,
            maxChars: compression.maxChars,
            usedChars: compression.usedChars
          }
        : undefined
    });
    if (traceEnabled) {
      response.effectiveOptions = {
        profile: resolvedOptions.effective.profile,
        sources: resolvedOptions.effective.sources,
        depth,
        include
      };
      response.decisionTrace = {
        profileApplied: resolvedOptions.effective.profile ?? null,
        sourcesApplied: resolvedOptions.effective.sources ?? null
      };
    }
    return response;

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

  private shouldBuildFallbackGraph(reasons: string[]): boolean {
    return reasons.some((reason) =>
      reason === "language_query_missing"
      || reason === "language_parser_unavailable"
      || reason === "unsupported_language"
      || reason === "missing_query_pack"
      || reason === "missing_wasm_grammar"
    );
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
