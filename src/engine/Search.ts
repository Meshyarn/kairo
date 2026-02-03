import path from "path";
import { QueryTokenizer } from "./QueryTokenizer.js";
import { FileSearchResult, ResourceBudget, ResourceUsage, SearchOptions, SearchProjectResultEntry, SymbolIndex } from "../types.js";
import { IFileSystem } from "../platform/FileSystem.js";
import { ResultProcessor } from './search/ResultProcessor.js';
import { FilenameScorer } from './scoring/FilenameScorer.js';
import { QueryIntentDetector } from './search/QueryIntent.js';
import { createLogger } from "../utils/StructuredLogger.js";
import { metrics } from "../utils/MetricsCollector.js";
import { SymbolEmbeddingIndex } from '../indexing/SymbolEmbeddingIndex.js';
import { NativeSearchError, type NativeSearchCoreClient, type NativeSearchStats } from "./search/native/NativeSearchCore.js";
import { getBuiltinExcludeGlobs, globToRegExp, normalizeRelativePath, shouldInclude } from "./search/SearchGlobs.js";
import {
    buildKeywordConstraints,
    normalizeSnippetLength,
    buildCandidateQuery,
    buildKeywordRegexes,
    buildPatternRegexes,
    computeMatchStats,
    extractPatternHintTokens,
    findLineMatches,
    normalizeFileTypes
} from "./search/SearchUtils.js";
import { scanForMatches } from "./search/SearchScanner.js";

const DEFAULT_PREVIEW_LENGTH = 240;
const DEFAULT_MATCHES_PER_FILE = 5;

export interface ScoutArgs extends SearchOptions {
    maxResults?: number;
    query?: string;
    keywords?: string[]; // Deprecated, use query
    patterns?: string[]; // Deprecated, use query
    includeGlobs?: string[];
    excludeGlobs?: string[];
    gitDiffMode?: boolean;
    basePath?: string;
    fileTypes?: string[];
    snippetLength?: number;
    matchesPerFile?: number;
    groupByFile?: boolean;
    deduplicateByContent?: boolean;
    budget?: ResourceBudget;
    usage?: ResourceUsage;
    semanticSymbols?: boolean;
}

export interface SearchEngineOptions {
    maxPreviewLength?: number;
    maxMatchesPerFile?: number;
    symbolIndex?: SymbolIndex;
    symbolEmbeddingIndex?: SymbolEmbeddingIndex;
    nativeSearchCore?: NativeSearchCoreClient;
    repoId?: string;
}

export class SearchEngine {
    private readonly rootPath: string;
    private readonly fileSystem: IFileSystem;
    private defaultExcludeGlobs: string[];
    private readonly maxPreviewLength: number;
    private readonly maxMatchesPerFile: number;
    private readonly queryTokenizer: QueryTokenizer;
    private readonly logger = createLogger("Search");
    private readonly nativeSearchCore: NativeSearchCoreClient;
    private readonly repoId: string;

    private resultProcessor: ResultProcessor;
    private filenameScorer: FilenameScorer;
    private queryIntentDetector: QueryIntentDetector;
    private symbolEmbeddingIndex?: SymbolEmbeddingIndex;

    constructor(rootPath: string, fileSystem: IFileSystem, initialExcludeGlobs: string[] = [], options: SearchEngineOptions = {}) {
        this.rootPath = path.resolve(rootPath);
        this.fileSystem = fileSystem;
        const combined = [...getBuiltinExcludeGlobs(), ...initialExcludeGlobs];
        this.defaultExcludeGlobs = Array.from(new Set(combined));
        this.maxPreviewLength = options.maxPreviewLength ?? DEFAULT_PREVIEW_LENGTH;
        this.maxMatchesPerFile = options.maxMatchesPerFile ?? DEFAULT_MATCHES_PER_FILE;
        this.queryTokenizer = new QueryTokenizer();
        if (!options.nativeSearchCore) {
            throw new NativeSearchError("CAP_NATIVE_SEARCH_UNAVAILABLE", "Native search core is required.");
        }
        this.nativeSearchCore = options.nativeSearchCore;
        this.repoId = options.repoId ?? "default";

        this.filenameScorer = new FilenameScorer();
        this.queryIntentDetector = new QueryIntentDetector();
        this.symbolEmbeddingIndex = options.symbolEmbeddingIndex;
        if (this.symbolEmbeddingIndex) {
            this.logger.info('[Search] Symbol embedding search enabled');
        }

        this.resultProcessor = new ResultProcessor();
    }

    public async dispose(): Promise<void> {
        // SearchEngine does not own the native core lifecycle.
    }

    public async updateExcludeGlobs(patterns: string[]): Promise<void> {
        const combined = [...getBuiltinExcludeGlobs(), ...patterns];
        this.defaultExcludeGlobs = Array.from(new Set(combined));
    }

    public getExcludeGlobs(): string[] {
        return [...this.defaultExcludeGlobs];
    }

    public async warmup(): Promise<void> {
        try {
            this.nativeSearchCore.stats();
        } catch {
            // best-effort warmup
        }
    }

    public setSymbolEmbeddingIndex(index?: SymbolEmbeddingIndex): void {
        this.symbolEmbeddingIndex = index;
        if (index) {
            this.logger.info('[Search] Symbol embedding search enabled');
        }
    }

    public isIndexReady(): boolean {
        try {
            this.nativeSearchCore.stats();
            return true;
        } catch {
            return false;
        }
    }

    public isIndexBuilding(): boolean {
        return false;
    }

    public getNativeStatus(): { available: boolean; stats?: NativeSearchStats; error?: string } {
        try {
            const stats = this.nativeSearchCore.stats();
            return { available: true, stats };
        } catch (error: any) {
            return { available: false, error: error?.message ?? String(error) };
        }
    }

    public async rebuild(options?: { logEvery?: number; logger?: (message: string) => void; logTotals?: boolean }): Promise<void> {
        if (typeof this.nativeSearchCore.reset === "function") {
            this.nativeSearchCore.reset();
        } else {
            throw new NativeSearchError("CAP_NATIVE_SEARCH_UNAVAILABLE", "Native search reset not supported.");
        }
    }

    public async invalidateFile(absPath: string): Promise<void> {
        const relative = normalizeRelativePath(absPath, this.rootPath);
        if (!relative) return;
        try {
            this.nativeSearchCore.deleteDoc({
                kind: "code_file",
                repoId: this.repoId,
                path: relative.replace(/\\/g, "/")
            });
        } catch {
            // best-effort (native index may be read-only / write-locked)
        }
    }

    public async invalidateDirectory(absDir: string): Promise<void> {
        void absDir;
    }

    public async runFileGrep(searchPattern: string, filePath: string): Promise<number[]> {
        let regex: RegExp;
        try {
            regex = new RegExp(searchPattern, "g");
        } catch {
            regex = new RegExp(this.escapeRegExp(searchPattern), "g");
        }
        let content: string;
        try {
            content = await this.fileSystem.readFile(filePath);
        } catch {
            return [];
        }
        const lines = content.split(/\r?\n/);
        const matches: number[] = [];
        for (let index = 0; index < lines.length; index++) {
            regex.lastIndex = 0;
            if (regex.test(lines[index])) {
                matches.push(index + 1);
            }
        }
        return matches;
    }

    public escapeRegExp(value: string, options: SearchOptions = {}): string {
        const escaped = value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
        return options.wordBoundary ? `\\b${escaped}\\b` : escaped;
    }

    public async scout(args: ScoutArgs): Promise<FileSearchResult[]> {
        return this.scoutNative(args);
    }

    private async scoutNative(args: ScoutArgs): Promise<FileSearchResult[]> {
        const stopTotal = metrics.startTimer("search.scout.total_ms");
        const { query, includeGlobs, excludeGlobs, basePath, patterns } = args;
        const budget = args.budget;
        const usage = args.usage ?? (budget ? { filesRead: 0, bytesRead: 0, parseTimeMs: 0 } : undefined);
        const startedAt = Date.now();

        try {
            if (!query && (!args.keywords || args.keywords.length === 0) && (!patterns || patterns.length === 0)) {
                throw new Error("A query string, keyword, or pattern is required.");
            }

            const smartCase = args.smartCase ?? true;
            const caseSensitive = Boolean(args.caseSensitive);
            let wordBoundary = Boolean(args.wordBoundary);

            const keywordSource = query && query.trim().length > 0
                ? this.queryTokenizer.tokenize(query)
                : (args.keywords ?? []).filter((kw): kw is string => typeof kw === "string" && kw.trim().length > 0);
            const keywordConstraints = buildKeywordConstraints(keywordSource, { caseSensitive, smartCase });
            const keywordLabels = keywordConstraints.map(keyword => keyword.raw);
            const effectiveQuery = query || keywordSource.join(' ');
            const normalizedFileTypes = normalizeFileTypes(args.fileTypes);
            const patternHints = extractPatternHintTokens(patterns);
            const candidateQuery = buildCandidateQuery(this.queryTokenizer, effectiveQuery, patternHints);
            const intent = this.queryIntentDetector.detect(effectiveQuery);
            if (intent === "symbol" && args.wordBoundary === undefined) {
                wordBoundary = true;
            }

            this.logger.debug(`[Search] Native search for query: "${effectiveQuery}" (intent: ${intent}, keywords: ${keywordLabels.join(', ')})`);

            const combinedExcludeGlobs = [...this.defaultExcludeGlobs, ...(excludeGlobs || [])];
            const includeRegexes = includeGlobs && includeGlobs.length > 0
                ? includeGlobs.map(glob => globToRegExp(glob))
                : undefined;
            const excludeRegexes = combinedExcludeGlobs.map(glob => globToRegExp(glob));

            const previewLength = normalizeSnippetLength(args.snippetLength, this.maxPreviewLength);
            const matchesPerFileLimit = args.matchesPerFile ?? this.maxMatchesPerFile;

            const maxResults = typeof args.maxResults === "number" && Number.isFinite(args.maxResults)
                ? Math.max(1, Math.floor(args.maxResults))
                : 50;
            const nativeLimit = Math.min(500, Math.max(maxResults, budget?.maxCandidates ?? 200));

            let hits: Array<{ path: string; score: number }> = [];
            let nativeSearchFailed = false;
            const forceScan = candidateQuery.length === 0;
            try {
                if (!forceScan) {
                    hits = this.nativeSearchCore.search({
                        kind: "code_file",
                        query: candidateQuery,
                        limit: nativeLimit,
                        fileTypes: normalizedFileTypes,
                        repoIds: [this.repoId]
                    });
                }
            } catch (error) {
                nativeSearchFailed = true;
                if (usage) {
                    usage.degraded = true;
                    usage.reason = usage.reason ?? (error instanceof NativeSearchError ? error.code : "native_search_failed");
                }
            }

            const keywordRegexes = buildKeywordRegexes(keywordConstraints, {
                escape: (value) => this.escapeRegExp(value, { wordBoundary })
            });
            const patternRegexes = buildPatternRegexes(patterns, {
                caseSensitive,
                escape: (value) => this.escapeRegExp(value)
            });
            const regexes = [...keywordRegexes, ...patternRegexes];

            if (nativeSearchFailed || hits.length === 0) {
                let stats: NativeSearchStats | undefined;
                if (!nativeSearchFailed && !forceScan) {
                    try {
                        stats = this.nativeSearchCore.stats();
                    } catch {
                        nativeSearchFailed = true;
                    }
                }
                const shouldFallback = forceScan || nativeSearchFailed || (stats?.docCount ?? 0) === 0;
                if (shouldFallback) {
                    const reason = forceScan ? "scan_required" : (nativeSearchFailed ? "native_search_failed" : "native_search_empty");
                    const fallbackResults = await this.scanForMatches({
                        basePath: basePath ? path.resolve(basePath) : undefined,
                        includeRegexes,
                        excludeRegexes,
                        regexes,
                        keywordRegexes,
                        patternRegexes,
                        keywords: keywordLabels,
                        previewLength,
                        matchesPerFileLimit,
                        maxResults,
                        fileTypes: normalizedFileTypes,
                        budget,
                        usage,
                        startedAt,
                        reason
                    });
                    if (usage) {
                        usage.parseTimeMs = Date.now() - startedAt;
                    }
                    return this.resultProcessor.postProcessResults(fallbackResults, {
                        fileTypes: normalizedFileTypes,
                        snippetLength: previewLength,
                        groupByFile: args.groupByFile,
                        deduplicateByContent: args.deduplicateByContent
                    });
                }
            }

            const fileSearchResults: FileSearchResult[] = [];
            for (const hit of hits) {
                if (fileSearchResults.length >= maxResults) {
                    break;
                }
                if (budget && usage) {
                    const elapsed = Date.now() - startedAt;
                    if (usage.filesRead >= budget.maxFilesRead || usage.bytesRead >= budget.maxBytesRead || elapsed >= budget.maxParseTimeMs) {
                        usage.degraded = true;
                        usage.reason = usage.reason ?? 'budget_exceeded';
                        break;
                    }
                }

                const relativePath = hit.path;
                const absPath = path.isAbsolute(relativePath)
                    ? relativePath
                    : path.join(this.rootPath, relativePath);
                const relativeToBase = normalizeRelativePath(absPath, basePath ? path.resolve(basePath) : this.rootPath);
                if (!relativeToBase || !shouldInclude(relativeToBase, includeRegexes, excludeRegexes)) {
                    continue;
                }

                let content = "";
                try {
                    content = await this.fileSystem.readFile(absPath);
                    if (usage) {
                        usage.filesRead += 1;
                        usage.bytesRead += Buffer.byteLength(content, 'utf8');
                    }
                } catch {
                    continue;
                }

                const matches = findLineMatches(content, regexes, matchesPerFileLimit, previewLength);
                if (matches.length === 0) {
                    continue;
                }
                const matchStats = computeMatchStats(content, path.basename(relativeToBase), keywordLabels, keywordRegexes, patternRegexes);

                for (const match of matches) {
                    fileSearchResults.push({
                        filePath: relativeToBase,
                        lineNumber: match.line,
                        preview: match.preview,
                        score: hit.score,
                        scoreDetails: {
                            type: "native",
                            totalScore: hit.score,
                            contentScore: matchStats.totalMatches,
                            filenameMatchType: matchStats.filenameMatchType,
                            filenameMultiplier: matchStats.filenameMultiplier,
                            depthMultiplier: 1,
                            fieldWeight: 1
                        }
                    });
                    if (fileSearchResults.length >= maxResults) {
                        break;
                    }
                }
            }

            fileSearchResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            metrics.gauge("search.scout.results_count", fileSearchResults.length);
            if (usage) {
                usage.parseTimeMs = Date.now() - startedAt;
            }

            return this.resultProcessor.postProcessResults(fileSearchResults, {
                fileTypes: normalizedFileTypes,
                snippetLength: previewLength,
                groupByFile: args.groupByFile,
                deduplicateByContent: args.deduplicateByContent
            });
        } finally {
            stopTotal();
        }
    }

    private async scanForMatches(args: {
        basePath?: string;
        includeRegexes?: RegExp[];
        excludeRegexes: RegExp[];
        regexes: RegExp[];
        keywordRegexes: RegExp[];
        patternRegexes: RegExp[];
        keywords: string[];
        previewLength: number;
        matchesPerFileLimit: number;
        maxResults: number;
        fileTypes?: string[];
        budget?: ResourceBudget;
        usage?: ResourceUsage;
        startedAt: number;
        reason: string;
    }): Promise<FileSearchResult[]> {
        return scanForMatches({
            fileSystem: this.fileSystem,
            rootPath: this.rootPath,
            basePath: args.basePath,
            includeRegexes: args.includeRegexes,
            excludeRegexes: args.excludeRegexes,
            regexes: args.regexes,
            keywordRegexes: args.keywordRegexes,
            patternRegexes: args.patternRegexes,
            keywords: args.keywords,
            previewLength: args.previewLength,
            matchesPerFileLimit: args.matchesPerFileLimit,
            maxResults: args.maxResults,
            fileTypes: args.fileTypes,
            budget: args.budget,
            usage: args.usage,
            startedAt: args.startedAt,
            reason: args.reason,
            normalizeRelativePath,
            shouldInclude
        });
    }

    public async searchFilenames(
        query: string,
        options: {
            fuzzyFilename?: boolean;
            filenameOnly?: boolean;
            maxResults?: number;
        } = {}
    ): Promise<SearchProjectResultEntry[]> {
        const allFiles = await this.fileSystem.listFiles(this.rootPath);
        const { fuzzyFilename = true, filenameOnly = false, maxResults = 20 } = options;
        const excludeRegexes = this.defaultExcludeGlobs.map(glob => globToRegExp(glob));
        const filteredFiles = allFiles.filter((filepath: string) => {
            const relative = normalizeRelativePath(filepath, this.rootPath);
            if (!relative) {
                return false;
            }
            return shouldInclude(relative, undefined, excludeRegexes);
        });

        const matches = filteredFiles
            .map((filepath: string) => ({
                filepath,
                filename: path.basename(filepath),
                score: this.filenameScorer.calculateFilenameScore(
                    filepath,
                    query,
                    { fuzzy: fuzzyFilename, basenameOnly: filenameOnly }
                )
            }))
            .filter((match: { score: number }) => match.score > 0)
            .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
            .slice(0, maxResults);

        return matches.map((match: { filepath: string, filename: string, score: number }) => ({
            type: "filename",
            path: match.filepath,
            score: match.score / 100,
            context: `File: ${match.filename}`,
            line: undefined
        }));
    }

}
