import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { ResourceUsage } from "../types.js";
import { ErrorEnhancer } from "../errors/ErrorEnhancer.js";
import * as path from "path";
import { normalizeRepoScope, resolveRepoInfo, isRepoIdInScope } from "../utils/RepoScope.js";

export class SearchHandlers extends BaseHandler {
    constructor(private context: HandlerContext) {
        super();
    }

    async handle(name: string, args: any): Promise<any> {
        const pillarTools = new Set(['explore']);
        const internalTools = new Set(['project_search', 'file_search', 'file_scout']);

        if (pillarTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args, { explore: [] });
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }
            const result = await this.context.orchestrationEngine.executePillar(name, args);
            return this.jsonResponse(result);
        }

        if (internalTools.has(name)) {
            const requiredMap: Record<string, string[]> = {
                project_search: ['query'],
                file_search: [],
                file_scout: []
            };
            const missing = this.validateRequiredArgs(name, args, requiredMap);
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
                default:
                    break;
            }
        }
        return null;
    }

    private inferSearchType(query: string, declared: string): "file" | "symbol" | "directory" | "filename" {
        if (declared && declared !== "auto") {
            return declared as any;
        }
        if (/[\\/]/.test(query) || /\.[a-z0-9]+$/i.test(query)) {
            return "filename";
        }
        if (query.endsWith('/')) {
            return "directory";
        }
        return "file";
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
        const inferredType = this.inferSearchType(query, declaredType);
        let results: any[] = [];

        if (inferredType === 'filename') {
            results = await this.context.searchEngine.searchFilenames(query, { maxResults });
        } else if (inferredType === 'symbol') {
            const matches = await this.context.symbolIndex.search(query);
            results = matches.slice(0, maxResults).map(match => ({
                type: 'symbol',
                path: match.filePath,
                score: 1,
                context: `${match.symbol.type} ${match.symbol.name}`,
                line: typeof match.symbol?.range?.startLine === 'number' ? match.symbol.range.startLine : undefined,
                symbol: match.symbol
            }));
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

            if (usage?.degraded) {
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

        const normalizedResults = results
            .map((item) => {
                if (!item?.path || typeof item.path !== "string") return null;
                try {
                    const repoInfo = resolveRepoInfo(item.path, this.context.repoRegistry, this.context.pathNormalizer);
                    if (!isRepoIdInScope(repoInfo.repoId, repoScope)) return null;
                    return {
                        ...item,
                        path: repoInfo.workspacePath,
                        repoId: repoInfo.repoId,
                        repoRelativePath: repoInfo.repoRelativePath
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean) as any[];

        if (normalizedResults.length === 0) {
            const enhanced = ErrorEnhancer.enhanceSearchNotFound(query);
            return {
                results: [],
                inferredType,
                message: `No results found for "${query}".`,
                suggestions: enhanced.toolSuggestions,
                nextActionHint: enhanced.nextActionHint,
                degraded: usage?.degraded ?? false,
                budget: budget ? { ...budget, used: usage } : undefined
            };
        }

        return {
            results: normalizedResults,
            inferredType,
            degraded: usage?.degraded ?? false,
            budget: budget ? { ...budget, used: usage } : undefined
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
        return results;
    }

    private async scoutFilesRaw(args: any) {
        const results = await this.searchFilesRaw(args);
        return { success: true, results };
    }
}
