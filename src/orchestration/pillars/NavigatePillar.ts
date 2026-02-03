
import { InternalToolRegistry } from '../InternalToolRegistry.js';
import { OrchestrationContext } from '../OrchestrationContext.js';
import { ParsedIntent } from '../IntentRouter.js';
import { BudgetManager } from '../BudgetManager.js';
import { analyzeQuery, isStrongQuery } from '../../engine/search/QueryMetrics.js';
import { resolveProgressState, logProgress, logToolStart, logToolEnd, ProgressState } from '../../utils/ProgressLogger.js';
import { buildDegradedReasons } from '../DegradedReasonMapper.js';
import { checkSkeletonSupport } from '../../ast/LanguageSupportSignals.js';
import { AstManager } from '../../ast/AstManager.js';
import type { RepoRegistry } from '../../config/RepoRegistry.js';
import type { PathNormalizer } from '../../utils/PathNormalizer.js';
import {
  applyContextFilter,
  attachGraphRagClusters,
  computePageRankFromEdges,
  extractLine,
  isDefinitionSymbol,
  isDocPath,
  isTestPath,
  loadHotSpotSet,
  loadPageRankScores,
  loadRelatedSymbols,
  resolveDocPath,
  resolveSafeRepoInfo,
  truncateText
} from "./NavigatePillarHelpers.js";


export class NavigatePillar {
  constructor(private readonly registry: InternalToolRegistry) {}

  public computePageRankFromEdges(edges: Array<{ source?: string; target?: string; from?: string; to?: string }>): Map<string, number> {
    return computePageRankFromEdges(edges);
  }

  public async resolveDocPath(
    context: OrchestrationContext,
    target: string,
    progress?: ProgressState
  ): Promise<string | null> {
    const runTool = (tool: string, args: any, stepProgress?: ProgressState) =>
      this.runTool(context, tool, args, stepProgress);
    return resolveDocPath(runTool, target, progress);
  }

  public async applyContextFilter(
    context: OrchestrationContext,
    target: string,
    contextMode: string,
    results: any[],
    limit: number,
    progress?: ProgressState
  ): Promise<any[]> {
    const runTool = (tool: string, args: any, stepProgress?: ProgressState) =>
      this.runTool(context, tool, args, stepProgress);
    return applyContextFilter(runTool, target, contextMode, results, limit, progress);
  }

  public async loadHotSpotSet(
    context: OrchestrationContext,
    results: any[],
    progress?: ProgressState
  ): Promise<Set<string>> {
    const runTool = (tool: string, args: any, stepProgress?: ProgressState) =>
      this.runTool(context, tool, args, stepProgress);
    return loadHotSpotSet(runTool, results, progress);
  }

  public async loadPageRankScores(
    context: OrchestrationContext,
    results: any[],
    progress?: ProgressState
  ): Promise<Map<string, number>> {
    const runTool = (tool: string, args: any, stepProgress?: ProgressState) =>
      this.runTool(context, tool, args, stepProgress);
    return loadPageRankScores(runTool, results, progress);
  }

  public async loadRelatedSymbols(
    context: OrchestrationContext,
    target: string,
    progress?: ProgressState
  ): Promise<string[]> {
    const runTool = (tool: string, args: any, stepProgress?: ProgressState) =>
      this.runTool(context, tool, args, stepProgress);
    return loadRelatedSymbols(runTool, target, progress);
  }

  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const { targets, constraints, originalIntent } = intent;
    const target = targets[0] || originalIntent;
    const limit = constraints.limit || 10;
    const contextMode = constraints.context ?? 'all';
    const include = (constraints.include ?? {}) as any;
    const includeClusters = include.clusters === true;
    const clusterOptions = constraints.clusterOptions as { maxClusters?: number; expansionDepth?: number; includePreview?: boolean } | undefined;
    const repoRegistry = this.registry.getMetadata<RepoRegistry>("repoRegistry");
    const pathNormalizer = this.registry.getMetadata<PathNormalizer>("pathNormalizer");
    const progress = resolveProgressState('Navigate', constraints);
    const startedAt = Date.now();
    const runTool = (tool: string, args: any, stepProgress?: ProgressState) =>
      this.runTool(context, tool, args, stepProgress);

    logProgress(progress, `Start target="${target}" limit=${limit} context=${contextMode}.`);

    const metrics = analyzeQuery(target);
    const docSearchEnabled = contextMode === 'docs' && !metrics.hasPath;
    const docDirectEnabled = contextMode === 'docs' && metrics.hasPath;
    let projectStats: any = undefined;
    try {
      projectStats = await this.runTool(context, 'project_profile', {}, progress);
    } catch {
      projectStats = undefined;
    }
    const budget = BudgetManager.create({
      category: 'navigate',
      queryLength: metrics.length,
      tokenCount: metrics.tokenCount,
      strongQuery: metrics.strong,
      includeGraph: include.pageRank,
      includeHotSpots: include.hotSpots,
      projectStats: { fileCount: projectStats?.fileCount }
    });

    if (docDirectEnabled) {
      const resolvedDoc = await resolveDocPath(runTool, target, progress);
        if (resolvedDoc) {
          try {
          const docSkeleton = await this.runTool(context, 'document_skeleton', { filePath: resolvedDoc }, progress);
          const docToc = await this.runTool(context, 'document_toc', { filePath: resolvedDoc }, progress);
          const docRefs = await this.runTool(context, 'document_references', { filePath: resolvedDoc }, progress);
          const maxSnippetChars = Number.parseInt(process.env.KAIRO_DOC_SNIPPET_MAX_CHARS ?? "1200", 10);
          const skeletonSnippet = truncateText(docSkeleton?.skeleton ?? "", maxSnippetChars);
          const repoInfo = resolveSafeRepoInfo(resolvedDoc, repoRegistry, pathNormalizer);
          const response: any = {
            success: true,
            status: 'success',
            locations: [
              {
                filePath: resolvedDoc,
                line: 1,
                snippet: skeletonSnippet,
                relevance: 1,
                type: 'doc',
                ...repoInfo
              }
            ],
            codePreview: skeletonSnippet,
            document: {
              outline: docToc?.outline ?? [],
              references: docRefs?.references ?? [],
              categorizedReferences: docRefs?.categorized ?? {}
            },
            degraded: Boolean(docSkeleton?.degraded || docToc?.degraded || docRefs?.degraded),
            budget
          };
          const docClusterReasons = await attachGraphRagClusters({
            registry: this.registry,
            response,
            query: target,
            includeClusters,
            clusterOptions,
            projectFileCount: projectStats?.fileCount,
            docHint: true
          });
          if (docClusterReasons.length > 0) {
            response.degraded = true;
            response.degradedReasons = buildDegradedReasons(docClusterReasons);
          }
          return response;
        } catch {
          // fall back to search
        }
      }
    }

    if (docSearchEnabled) {
      try {
        const docResults = await this.runTool(context, 'document_search', {
          query: target,
          output: "compact",
          maxResults: limit,
          includeEvidence: false
        }, progress);
        const sections = Array.isArray(docResults?.results) ? docResults.results : [];
        if (sections.length > 0) {
          const locations = sections.map((section: any) => {
            const filePath = section.filePath ?? '';
            const resolvedRepo = resolveSafeRepoInfo(filePath, repoRegistry, pathNormalizer);
            return {
              filePath,
              line: section.range?.startLine ?? 0,
              snippet: section.preview ?? '',
              relevance: section.scores?.final ?? 0,
              type: 'doc',
              repoId: section.repoId ?? resolvedRepo.repoId,
              repoRelativePath: section.repoRelativePath ?? resolvedRepo.repoRelativePath
            };
          });
          logProgress(progress, `Doc search results: ${locations.length}.`);
          const response: any = {
            success: true,
            status: 'success',
            locations,
            codePreview: locations[0]?.snippet,
            document: {
              query: target,
              pack: docResults?.pack,
              results: sections
            },
            degraded: docResults?.degraded ?? false,
            budget
          };
          const docClusterReasons = await attachGraphRagClusters({
            registry: this.registry,
            response,
            query: target,
            includeClusters,
            clusterOptions,
            projectFileCount: projectStats?.fileCount,
            docHint: true
          });
          if (docClusterReasons.length > 0) {
            response.degraded = true;
            response.degradedReasons = buildDegradedReasons(docClusterReasons);
          }
          return response;
        }
      } catch {
        // fall back to filename/content search
      }
    }

    const initialType = metrics.hasPath
      ? 'filename'
      : (contextMode === 'definitions' ? 'symbol' : (metrics.hasSymbolHint ? 'symbol' : 'filename'));

    const [filenameResult, symbolResult] = await Promise.all([
      this.runTool(context, 'project_search', {
        query: target,
        maxResults: limit,
        type: 'filename'
      }, progress),
      this.runTool(context, 'project_search', {
        query: target,
        maxResults: limit,
        type: 'symbol'
      }, progress)
    ]);

    const combined = [...(symbolResult?.results ?? []), ...(filenameResult?.results ?? [])];
    const seen = new Set<string>();
    let rawResults = combined.filter((item: any) => {
      const pathValue = item?.path;
      if (!pathValue) return false;
      if (seen.has(pathValue)) return false;
      seen.add(pathValue);
      return true;
    }).slice(0, limit);

    const initialResult = initialType === 'filename' ? filenameResult : symbolResult;
    logProgress(progress, `Search results: ${rawResults.length}.`);
    const highConfidence = rawResults.length > 0 && (rawResults[0]?.score ?? 0) >= 0.9;
    const allowContent = isStrongQuery(metrics) && contextMode === 'all';
    let refinementStage: string = initialType;
    let refinementReason: string | undefined = undefined;
    let finalBudget = initialResult?.budget;
    let finalDegraded = Boolean(initialResult?.degraded);

    if (!highConfidence && allowContent) {
      const contentResult = await this.runTool(context, 'project_search', {
        query: target,
        maxResults: limit,
        type: 'file',
        budget
      }, progress);
      if (Array.isArray(contentResult?.results) && contentResult.results.length > 0) {
        rawResults = contentResult.results;
        refinementStage = 'content';
        refinementReason = contentResult?.degraded ? 'budget_exceeded' : 'low_confidence';
        finalBudget = contentResult?.budget ?? finalBudget;
        finalDegraded = Boolean(contentResult?.degraded);
      }
    }

    rawResults = await applyContextFilter(runTool, target, contextMode, rawResults, limit, progress);
    logProgress(progress, `Filtered results: ${rawResults.length}.`);
    const allowHotSpots = include.hotSpots === true;
    const allowPageRank = include.pageRank === true;
    const allowRelatedSymbols = include.relatedSymbols === true;
    const hotSpotSet = allowHotSpots ? await loadHotSpotSet(runTool, rawResults, progress) : new Set();
    const pageRankScores = allowPageRank ? await loadPageRankScores(runTool, rawResults, progress) : new Map();
    const relatedSymbols = allowRelatedSymbols ? await loadRelatedSymbols(runTool, target, progress) : [];

    const locations = rawResults.map((item: any) => {
      const filePath = item.path ?? '';
      const snippet = item.context ?? '';
      const line = extractLine(item);
      const relevance = item.score ?? 0;
      const isTest = isTestPath(filePath);
      const isDoc = isDocPath(filePath);
      const inferredType = item.type === 'usage'
        ? 'usage'
        : (item.type === 'symbol' ? 'exact' : (relevance >= 0.9 ? 'exact' : 'related'));
      const type = isTest ? 'test' : (isDoc ? 'doc' : inferredType);
      const resolvedRepo = resolveSafeRepoInfo(filePath, repoRegistry, pathNormalizer);
      const repoInfo = {
        repoId: item.repoId ?? resolvedRepo.repoId,
        repoRelativePath: item.repoRelativePath ?? resolvedRepo.repoRelativePath
      };
      return {
        filePath,
        line,
        snippet,
        relevance,
        type,
        pageRank: pageRankScores.get(filePath),
        isHotSpot: hotSpotSet.has(filePath),
        ...repoInfo
      };
    });

    const parityReasons: string[] = [];
    if (refinementReason) parityReasons.push(refinementReason);
    let parityPath: string | undefined = undefined;
    let parityLanguageId: string | undefined = undefined;
    const response: any = {
      success: true,
      status: rawResults.length === 0 ? 'no_results' : 'success',
      locations,
      relatedSymbols,
      codePreview: locations[0]?.snippet,
      degraded: finalDegraded || (refinementReason === 'budget_exceeded') || false,
      budget: finalBudget ?? budget,
      refinement: {
        stage: refinementStage,
        reason: refinementReason
      }
    };

    // Eager Loading: 단일 결과인 경우 Smart File Profile 추가
    if (rawResults.length === 1) {
      const primary = rawResults[0];
      const profile = await this.runTool(context, 'file_profile', { filePath: primary.path }, progress);
      response.smartProfile = profile;
      if (primary?.path) {
        if (isDocPath(primary.path)) {
          const docSkeleton = await this.runTool(context, 'document_skeleton', { filePath: primary.path }, progress);
          if (typeof docSkeleton?.skeleton === 'string') {
            response.codePreview = docSkeleton.skeleton;
            response.document = { outline: docSkeleton.outline ?? [] };
          }
          if (Array.isArray(docSkeleton?.reasons)) {
            parityReasons.push(...docSkeleton.reasons);
          }
        } else {
          const skeleton = await this.runTool(context, 'code_read', { filePath: primary.path, view: 'skeleton' }, progress);
          if (typeof skeleton === 'string') {
            response.codePreview = skeleton;
          }
          const support = await checkSkeletonSupport(primary.path);
          if (support.degraded && support.reason) {
            parityReasons.push(support.reason);
            parityPath = primary.path;
            parityLanguageId = AstManager.getInstance().getLanguageId(primary.path);
          }
        }
      }
    }

    const clusterReasons = await attachGraphRagClusters({
      registry: this.registry,
      response,
      query: target,
      includeClusters,
      clusterOptions,
      projectFileCount: projectStats?.fileCount,
      docHint: contextMode === "docs"
    });
    if (clusterReasons.length > 0) {
      parityReasons.push(...clusterReasons);
    }

    response.degradedReasons = buildDegradedReasons(
      parityReasons.length > 0 ? parityReasons : undefined,
      parityPath ? { filePath: parityPath, languageId: parityLanguageId } : undefined
    );
    if (parityReasons.length > 0) {
      response.degraded = true;
    }

    const elapsedMs = Date.now() - startedAt;
    logProgress(progress, `Completed in ${elapsedMs}ms.`);
    return response;
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
