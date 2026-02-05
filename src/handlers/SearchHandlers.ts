import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { ResourceUsage } from "../types.js";
import { ErrorEnhancer } from "../errors/ErrorEnhancer.js";
import * as path from "path";
import { normalizeRepoScope } from "../utils/RepoScope.js";
import { buildDegradedReasons } from "../orchestration/DegradedReasonMapper.js";
import { metrics } from "../utils/MetricsCollector.js";
import { fallbackFileSearch, inferSearchType, normalizeSearchResults } from "./SearchHandlersUtils.js";

export class SearchHandlers extends BaseHandler {
    constructor(private context: HandlerContext) {
        super(context.toolSpecRegistry);
    }

    async handle(name: string, args: any): Promise<any> {
        const pillarTools = new Set(['explore']);
        const internalTools = new Set(['project_search', 'file_search', 'file_scout', 'symbol_semantic_search']);

        if (pillarTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args);
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }
            const result = await this.context.orchestrationEngine.executePillar(name, args);
            return this.jsonResponse(result);
        }

        if (internalTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args);
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }

            switch (name) {
                case 'project_search':
                    return this.jsonResponse(await this.searchProjectRaw(args));
                case 'file_search':
                    return this.jsonResponse(await this.searchFilesRaw(args));
                case 'file_scout':
                    return this.jsonResponse(await this.scoutFilesRaw(args));
                case 'symbol_semantic_search':
                    return this.jsonResponse(await this.searchSymbolSemanticRaw(args));
                default:
                    break;
            }
        }
        return null;
    }

    private async searchProjectRaw(args: any) {
        const query = args?.query ?? args?.keywords?.join?.(' ') ?? args?.patterns?.join?.(' ');
        if (!query) {
            throw new Error("Missing required parameter: query");
        }
        const repoScope = normalizeRepoScope(args ?? {}, this.context.repoRegistry, { defaultMode: "all" });
        const budget = args?.budget;
        const usage = budget ? ({ filesRead: 0, bytesRead: 0, parseTimeMs: 0 } as ResourceUsage) : undefined;
        const maxResults = typeof args.maxResults === "number"
            ? args.maxResults
            : (typeof args.limit === "number" ? args.limit : 20);
        const declaredType = (args.type ?? 'auto') as string;
        const inferredType = inferSearchType(query, declaredType);
        let results: any[] = [];
        const degradedReasons: string[] = [];
        const semanticSymbols = args?.semanticSymbols === true;

        if (inferredType === 'filename') {
            results = await this.context.searchEngine.searchFilenames(query, { maxResults });
        } else if (inferredType === 'symbol') {
            if (semanticSymbols) {
                metrics.inc("symbol_search.semantic.count");
                const semanticEnabled = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_ENABLED ?? "false").toLowerCase() === "true";
                const semanticMode = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_MODE ?? "manual").toLowerCase();
                if (!semanticEnabled || semanticMode === "off") {
                    degradedReasons.push("symbol_semantic_search_disabled");
                } else if (!this.context.symbolEmbeddingIndex) {
                    degradedReasons.push("embedding_provider_disabled");
                } else {
                    const status = this.context.symbolEmbeddingIndex.getStatus();
                    if (!status.lastBuildAt) {
                        degradedReasons.push("symbol_embeddings_not_built");
                    } else {
                        const stopTimer = metrics.startTimer("symbol_search.semantic_ms");
                        const semantic = await this.context.symbolEmbeddingIndex.searchSymbolsWithDiagnostics(query, {
                            topK: maxResults
                        });
                        stopTimer();
                        if (semantic.degraded && semantic.reason) {
                            degradedReasons.push(semantic.reason);
                            metrics.inc("symbol_search.semantic.degraded.count");
                            metrics.inc(`symbol_search.semantic.degraded_reason.${semantic.reason}`);
                        }
                        if (semantic.results.length > 0) {
                            results = semantic.results.slice(0, maxResults).map(match => ({
                                type: "symbol",
                                path: match.symbol.filePath,
                                score: match.relevanceScore,
                                context: `${match.symbol.type} ${match.symbol.name}`,
                                line: match.symbol.lineRange?.start,
                                symbol: match.symbol,
                                semantic: {
                                    similarity: match.similarity,
                                    relevanceScore: match.relevanceScore,
                                    modelKey: status.symbolModelKey
                                }
                            }));
                        } else {
                            degradedReasons.push("symbol_search_fallback_name");
                            metrics.inc("symbol_search.semantic.fallback_name.count");
                        }
                    }
                }
            }

            if (results.length === 0) {
                const matches = await this.context.symbolIndex.search(query);
                results = matches.slice(0, maxResults).map(match => ({
                    type: 'symbol',
                    path: match.filePath,
                    score: 1,
                    context: `${match.symbol.type} ${match.symbol.name}`,
                    line: typeof match.symbol?.range?.startLine === 'number' ? match.symbol.range.startLine : undefined,
                    symbol: match.symbol
                }));
            }
        } else if (inferredType === 'directory') {
            const files = await this.context.fileSystem.listFiles(this.context.rootPath);
            const dirs = new Set<string>();
            for (const file of files) {
                dirs.add(path.dirname(path.relative(this.context.rootPath, file)).replace(/\\/g, '/'));
            }
            results = Array.from(dirs)
                .filter(dir => dir.toLowerCase().includes(String(query).toLowerCase()))
                .slice(0, maxResults)
                .map(dir => ({
                    type: 'directory',
                    path: dir,
                    score: 1,
                    context: `Directory: ${dir}`
                }));
        } else {
            const scoutResults = await this.context.searchEngine.scout({
                query,
                includeGlobs: args.includeGlobs,
                excludeGlobs: args.excludeGlobs,
                fileTypes: args.fileTypes,
                snippetLength: args.snippetLength,
                matchesPerFile: args.matchesPerFile,
                groupByFile: args.groupByFile,
                deduplicateByContent: args.deduplicateByContent,
                basePath: args.basePath,
                maxResults,
                semanticSymbols: args?.semanticSymbols === true,
                budget,
                usage
            });

            results = scoutResults.slice(0, maxResults).map(result => ({
                type: 'file',
                path: result.filePath,
                score: result.score ?? 0,
                context: result.preview,
                line: result.lineNumber,
                groupedMatches: result.groupedMatches,
                matchCount: result.matchCount
            }));

            if (usage?.degraded && results.length === 0) {
                const fallbackResults: any[] = [];
                try {
                    const filenameResults = await this.context.searchEngine.searchFilenames(query, { maxResults });
                    fallbackResults.push(...filenameResults);
                } catch {}
                if (fallbackResults.length < maxResults) {
                    try {
                        const symbolMatches = await this.context.symbolIndex.search(query);
                        fallbackResults.push(...symbolMatches.slice(0, maxResults - fallbackResults.length).map(match => ({
                            type: 'symbol',
                            path: match.filePath,
                            score: 1,
                            context: `${match.symbol.type} ${match.symbol.name}`,
                            line: typeof match.symbol?.range?.startLine === 'number' ? match.symbol.range.startLine : undefined,
                            symbol: match.symbol
                        })));
                    } catch {}
                }
                if (fallbackResults.length > 0) {
                    results = fallbackResults.slice(0, maxResults);
                }
            }
        }

        const normalizedResults = normalizeSearchResults(results, this.context, repoScope);

        if (normalizedResults.length === 0) {
            const enhanced = ErrorEnhancer.enhanceSearchNotFound(query);
            return {
                results: [],
                inferredType,
                message: `No results found for "${query}".`,
                suggestions: enhanced.toolSuggestions,
                nextActionHint: enhanced.nextActionHint,
                degraded: (usage?.degraded ?? false) || degradedReasons.length > 0,
                budget: budget ? { ...budget, used: usage } : undefined,
                degradedReasons: buildDegradedReasons(degradedReasons)
            };
        }

        return {
            results: normalizedResults,
            inferredType,
            degraded: (usage?.degraded ?? false) || degradedReasons.length > 0,
            budget: budget ? { ...budget, used: usage } : undefined,
            degradedReasons: buildDegradedReasons(degradedReasons)
        };
    }

    private async searchSymbolSemanticRaw(args: any) {
        const query = args?.query ?? args?.text ?? args?.keywords?.join?.(" ");
        if (!query) {
            throw new Error("Missing required parameter: query");
        }
        const maxResults = typeof args?.maxResults === "number"
            ? args.maxResults
            : (typeof args?.limit === "number" ? args.limit : 20);
        const minSimilarity = typeof args?.minSimilarity === "number" ? args.minSimilarity : undefined;
        const rawSymbolTypes = Array.isArray(args?.symbolTypes) ? args.symbolTypes.filter(Boolean) : [];
        const filteredSymbolTypes = rawSymbolTypes.filter((entry: string) => entry !== "any");
        const symbolTypes = filteredSymbolTypes.length > 0 ? filteredSymbolTypes : undefined;
        const degradedReasons: string[] = [];

        const semanticEnabled = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_ENABLED ?? "false").toLowerCase() === "true";
        const semanticMode = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_MODE ?? "manual").toLowerCase();
        if (!semanticEnabled || semanticMode === "off") {
            degradedReasons.push("symbol_semantic_search_disabled");
        } else if (!this.context.symbolEmbeddingIndex) {
            degradedReasons.push("embedding_provider_disabled");
        } else {
            const status = this.context.symbolEmbeddingIndex.getStatus();
            if (!status.lastBuildAt) {
                degradedReasons.push("symbol_embeddings_not_built");
            } else {
                metrics.inc("symbol_search.semantic.count");
                const stopTimer = metrics.startTimer("symbol_search.semantic_ms");
                const semantic = await this.context.symbolEmbeddingIndex.searchSymbolsWithDiagnostics(String(query), {
                    topK: maxResults,
                    minSimilarity,
                    symbolTypes
                });
                stopTimer();
                if (semantic.degraded && semantic.reason) {
                    degradedReasons.push(semantic.reason);
                    metrics.inc("symbol_search.semantic.degraded.count");
                    metrics.inc(`symbol_search.semantic.degraded_reason.${semantic.reason}`);
                }
                const results = semantic.results.slice(0, maxResults).map(match => ({
                    type: "symbol",
                    path: match.symbol.filePath,
                    score: match.relevanceScore,
                    context: `${match.symbol.type} ${match.symbol.name}`,
                    line: match.symbol.lineRange?.start,
                    symbol: match.symbol,
                    semantic: {
                        similarity: match.similarity,
                        relevanceScore: match.relevanceScore,
                        modelKey: status.symbolModelKey,
                        backend: semantic.backend
                    }
                }));
                const normalizedResults = normalizeSearchResults(results, this.context, undefined);
                return {
                    query: String(query),
                    results: normalizedResults,
                    degraded: degradedReasons.length > 0,
                    degradedReasons: buildDegradedReasons(degradedReasons)
                };
            }
        }

        return {
            query: String(query),
            results: [],
            degraded: degradedReasons.length > 0,
            degradedReasons: buildDegradedReasons(degradedReasons)
        };
    }

    private async searchFilesRaw(args: any) {
        const results = await this.context.searchEngine.scout({
            query: args?.query,
            keywords: args?.keywords,
            patterns: args?.patterns,
            includeGlobs: args?.includeGlobs,
            excludeGlobs: args?.excludeGlobs,
            fileTypes: args?.fileTypes,
            snippetLength: args?.snippetLength,
            matchesPerFile: args?.matchesPerFile,
            groupByFile: args?.groupByFile,
            deduplicateByContent: args?.deduplicateByContent,
            basePath: args?.basePath,
            smartCase: args?.smartCase,
            caseSensitive: args?.caseSensitive,
            wordBoundary: args?.wordBoundary,
            maxResults: args?.maxResults
        });
        if (results.length === 0 && (args?.keywords?.length || args?.patterns?.length) && typeof args?.basePath === "string") {
            return fallbackFileSearch(this.context, args);
        }
        return results;
    }

    private async scoutFilesRaw(args: any) {
        const results = await this.searchFilesRaw(args);
        return { success: true, results };
    }

}
