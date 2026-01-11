
import { InternalToolRegistry } from '../InternalToolRegistry.js';
import { OrchestrationContext } from '../OrchestrationContext.js';
import { ParsedIntent } from '../IntentRouter.js';
import { BudgetManager } from '../BudgetManager.js';
import { analyzeQuery, isStrongQuery } from '../../engine/search/QueryMetrics.js';
import { resolveProgressState, logProgress, logToolStart, logToolEnd, ProgressState } from '../../utils/ProgressLogger.js';
import { buildDegradedReasons } from '../DegradedReasonMapper.js';
import { checkSkeletonSupport } from '../../ast/LanguageSupportSignals.js';
import { AstManager } from '../../ast/AstManager.js';


export class NavigatePillar {
  constructor(private readonly registry: InternalToolRegistry) {}

  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const { targets, constraints, originalIntent } = intent;
    const target = targets[0] || originalIntent;
    const limit = constraints.limit || 10;
    const contextMode = constraints.context ?? 'all';
    const include = (constraints.include ?? {}) as any;
    const progress = resolveProgressState('Navigate', constraints);
    const startedAt = Date.now();

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
      const resolvedDoc = await this.resolveDocPath(context, target, progress);
        if (resolvedDoc) {
          try {
          const docSkeleton = await this.runTool(context, 'document_skeleton', { filePath: resolvedDoc }, progress);
          const docToc = await this.runTool(context, 'document_toc', { filePath: resolvedDoc }, progress);
          const docRefs = await this.runTool(context, 'document_references', { filePath: resolvedDoc }, progress);
          const maxSnippetChars = Number.parseInt(process.env.KAIRO_DOC_SNIPPET_MAX_CHARS ?? "1200", 10);
          const skeletonSnippet = truncateText(docSkeleton?.skeleton ?? "", maxSnippetChars);
          return {
            success: true,
            status: 'success',
            locations: [
              {
                filePath: resolvedDoc,
                line: 1,
                snippet: skeletonSnippet,
                relevance: 1,
                type: 'doc'
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
          const locations = sections.map((section: any) => ({
            filePath: section.filePath ?? '',
            line: section.range?.startLine ?? 0,
            snippet: section.preview ?? '',
            relevance: section.scores?.final ?? 0,
            type: 'doc'
          }));
          logProgress(progress, `Doc search results: ${locations.length}.`);
          return {
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

    rawResults = await this.applyContextFilter(context, target, contextMode, rawResults, limit, progress);
    logProgress(progress, `Filtered results: ${rawResults.length}.`);
    const allowHotSpots = include.hotSpots === true;
    const allowPageRank = include.pageRank === true;
    const allowRelatedSymbols = include.relatedSymbols === true;
    const hotSpotSet = allowHotSpots ? await this.loadHotSpotSet(context, rawResults, progress) : new Set();
    const pageRankScores = allowPageRank ? await this.loadPageRankScores(context, rawResults, progress) : new Map();
    const relatedSymbols = allowRelatedSymbols ? await this.loadRelatedSymbols(context, target, progress) : [];

    const locations = rawResults.map((item: any) => {
      const filePath = item.path ?? '';
      const snippet = item.context ?? '';
      const line = this.extractLine(item);
      const relevance = item.score ?? 0;
      const isTest = this.isTestPath(filePath);
      const isDoc = this.isDocPath(filePath);
      const inferredType = item.type === 'usage'
        ? 'usage'
        : (item.type === 'symbol' ? 'exact' : (relevance >= 0.9 ? 'exact' : 'related'));
      const type = isTest ? 'test' : (isDoc ? 'doc' : inferredType);
      return {
        filePath,
        line,
        snippet,
        relevance,
        type,
        pageRank: pageRankScores.get(filePath),
        isHotSpot: hotSpotSet.has(filePath)
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
        if (this.isDocPath(primary.path)) {
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

  private async loadHotSpotSet(
    context: OrchestrationContext,
    results: any[],
    progress?: ProgressState
  ): Promise<Set<string>> {
    if (results.length === 0) return new Set();
    if (results.length > 10) return new Set();
    let hotSpots: any = [];
    try {
      hotSpots = await this.runTool(context, 'hotspot_detect', {}, progress);
    } catch {
      return new Set();
    }
    const set = new Set<string>();
    if (Array.isArray(hotSpots)) {
      for (const spot of hotSpots) {
        if (spot?.filePath) set.add(spot.filePath);
      }
    }
    return set;
  }

  private async loadPageRankScores(
    context: OrchestrationContext,
    results: any[],
    progress?: ProgressState
  ): Promise<Map<string, number>> {
    if (results.length !== 1) return new Map();
    const targetPath = results[0]?.path;
    if (!targetPath) return new Map();
    try {
      const deps = await this.runTool(context, 'relationship_analyze', {
        target: targetPath,
        mode: 'dependencies',
        direction: 'both'
      }, progress);
      const edges = Array.isArray(deps?.edges) ? deps.edges : [];
      return this.computePageRankFromEdges(edges);
    } catch {
      return new Map();
    }
  }

  private computePageRankFromEdges(edges: Array<{ source?: string; target?: string; from?: string; to?: string }>): Map<string, number> {
    const normalized = edges
      .map(edge => ({ from: edge.from ?? edge.source, to: edge.to ?? edge.target }))
      .filter(edge => edge.from && edge.to) as Array<{ from: string; to: string }>;
    if (normalized.length === 0) return new Map();

    const nodes = new Set<string>();
    for (const edge of normalized) {
      nodes.add(edge.from);
      nodes.add(edge.to);
    }
    const ids = Array.from(nodes);
    const n = ids.length;
    if (n === 0) return new Map();

    const outgoing = new Map<string, string[]>();
    for (const id of ids) outgoing.set(id, []);
    for (const edge of normalized) {
      outgoing.get(edge.from)!.push(edge.to);
    }

    const damping = 0.85;
    let ranks = new Map<string, number>(ids.map(id => [id, 1 / n]));
    for (let iter = 0; iter < 12; iter++) {
      const next = new Map<string, number>(ids.map(id => [id, (1 - damping) / n]));
      for (const id of ids) {
        const outs = outgoing.get(id) ?? [];
        const share = (ranks.get(id) ?? 0) / (outs.length || n);
        if (outs.length === 0) {
          for (const other of ids) {
            next.set(other, (next.get(other) ?? 0) + damping * share);
          }
        } else {
          for (const to of outs) {
            next.set(to, (next.get(to) ?? 0) + damping * share);
          }
        }
      }
      ranks = next;
    }

    return ranks;
  }

  private async loadRelatedSymbols(
    context: OrchestrationContext,
    target: string,
    progress?: ProgressState
  ): Promise<string[]> {
    if (!target) return [];
    try {
      const matches = await this.runTool(context, 'project_search', {
        query: target,
        type: 'symbol',
        maxResults: 5
      }, progress);
      const results = matches?.results ?? [];
      return results
        .filter((item: any) => this.isDefinitionSymbol(item))
        .map((item: any) => item?.symbol?.name ?? item?.context ?? item?.path ?? '')
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async applyContextFilter(
    context: OrchestrationContext,
    target: string,
    contextMode: string,
    results: any[],
    limit: number,
    progress?: ProgressState
  ): Promise<any[]> {
    if (contextMode === 'all') return results;

    if (contextMode === 'definitions') {
      const filtered = results.filter(item => this.isDefinitionSymbol(item));
      return filtered.length > 0 ? filtered : results;
    }

    if (contextMode === 'usages') {
      const symbolMatch = await this.runTool(context, 'project_search', {
        query: target,
        type: 'symbol',
        maxResults: 1
      }, progress);
      const symbolResult = symbolMatch?.results?.find((item: any) => this.isDefinitionSymbol(item)) ?? symbolMatch?.results?.[0];
      const symbolName = symbolResult?.symbol?.name ?? target;
      const definitionPath = symbolResult?.path;
      if (definitionPath) {
        const references = await this.runTool(context, 'reference_find', {
          symbolName,
          definitionPath
        }, progress);
        const refs = references?.references ?? [];
        if (Array.isArray(refs) && refs.length > 0) {
          return refs.slice(0, limit).map((ref: any) => ({
            type: 'usage',
            path: ref.filePath ?? '',
            score: 1,
            context: ref.snippet ?? ref.text,
            line: ref.line
          }));
        }
      }
      return results;
    }

    if (contextMode === 'tests') {
      const filtered = results.filter((item: any) => this.isTestPath(item?.path ?? ''));
      if (filtered.length > 0) return filtered;
      const fallback = await this.runTool(context, 'project_search', {
        query: target,
        maxResults: limit,
        includeGlobs: ['**/*.test.*', '**/__tests__/**', '**/tests/**']
      });
      return fallback?.results ?? [];
    }

    if (contextMode === 'docs') {
      const filtered = results.filter((item: any) => this.isDocPath(item?.path ?? ''));
      if (filtered.length > 0) return filtered;
      const fallback = await this.runTool(context, 'project_search', {
        query: target,
        maxResults: limit,
        includeGlobs: ['**/*.md', '**/*.mdx', '**/docs/**']
      });
      return fallback?.results ?? [];
    }

    return results;
  }

  private async resolveDocPath(
    context: OrchestrationContext,
    target: string,
    progress?: ProgressState
  ): Promise<string | null> {
    if (!target) return null;
    const cleaned = target.replace(/^["'`]+|["'`]+$/g, '');
    if (this.isDocPath(cleaned)) {
      return cleaned;
    }
    if (!/[\\/]/.test(cleaned)) {
      const match = await this.runTool(context, 'project_search', {
        query: cleaned,
        type: 'filename',
        maxResults: 1,
        includeGlobs: ['**/*.md', '**/*.mdx', '**/docs/**']
      }, progress);
      return match?.results?.[0]?.path ?? null;
    }
    return cleaned;
  }

  private isTestPath(filePath: string): boolean {
    return /\/tests?\//i.test(filePath) || /\.test\./i.test(filePath);
  }

  private isDocPath(filePath: string): boolean {
    return /\.(md|mdx)$/i.test(filePath) || /\/docs\//i.test(filePath);
  }

  private isDefinitionSymbol(item: any): boolean {
    const type = item?.symbol?.type;
    if (!type) return true;
    return type !== 'import' && type !== 'export';
  }

  private extractLine(item: any): number {
    if (typeof item?.line === 'number') return item.line;
    const symbolLine = item?.symbol?.range?.startLine;
    if (typeof symbolLine === 'number') return symbolLine;
    return 0;
  }
}

function truncateText(text: string, maxChars: number): string {
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 1200;
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(1, limit - 1))}…`;
}
