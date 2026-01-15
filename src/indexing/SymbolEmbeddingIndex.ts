import type { EmbeddingProviderClient } from "../embeddings/EmbeddingProviderFactory.js";
import type { SymbolIndex } from "../ast/SymbolIndex.js";
import type { VectorIndexManager } from "../vector/VectorIndexManager.js";
import { SymbolVectorRepository, type CodeSymbol, type SymbolWithSimilarity } from "./SymbolVectorRepository.js";
import type { EmbeddingRepository } from "./EmbeddingRepository.js";
import type { DefinitionSymbol, SymbolInfo } from "../types.js";

/**
 * Configuration for SymbolEmbeddingIndex
 */
export interface SymbolEmbeddingConfig {
    /** Whether to enable symbol embedding indexing */
    enabled: boolean;
    /** Mode for symbol semantic search */
    mode: "off" | "manual";
    /** Batch size for symbol indexing */
    batchSize: number;
    /** Minimum similarity threshold for search results */
    minSimilarity: number;
    /** Maximum number of results to return */
    maxResults: number;
    /** Maximum chars to include per symbol text */
    maxTextChars: number;
    /** Model key for symbol embeddings (separate from docs) */
    symbolModelKey: string;
}

const DEFAULT_CONFIG: SymbolEmbeddingConfig = {
    enabled: true,
    mode: "manual",
    batchSize: 10,
    minSimilarity: 0.5,
    maxResults: 20,
    maxTextChars: 2000,
    symbolModelKey: "symbols_v1"
};

/**
 * Search result from SymbolEmbeddingIndex
 */
export interface SymbolSearchResult {
    symbol: CodeSymbol;
    similarity: number;
    relevanceScore: number;
}

/**
 * SymbolEmbeddingIndex - Layer 3 Symbol-based Semantic Search
 * 
 * Provides embedding-based search over code symbols (classes, functions, methods).
 * Enables natural language queries to find relevant symbols by semantic similarity.
 * 
 * Phase 1 Smart Fuzzy Match component.
 */
export class SymbolEmbeddingIndex {
    private readonly config: SymbolEmbeddingConfig;
    private readonly symbolVectorRepo: SymbolVectorRepository;
    private indexedSymbolCount: number = 0;
    private lastBuildAt?: number;

    constructor(
        private readonly symbolIndex: SymbolIndex,
        private readonly vectorIndexManager: VectorIndexManager,
        private readonly embeddingRepository: EmbeddingRepository,
        private readonly embeddingProvider: EmbeddingProviderClient,
        config: Partial<SymbolEmbeddingConfig> = {}
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.symbolVectorRepo = new SymbolVectorRepository(
            vectorIndexManager,
            embeddingProvider,
            symbolIndex,
            embeddingRepository,
            {
                provider: embeddingProvider.provider,
                model: this.config.symbolModelKey || embeddingProvider.model,
            }
        );
    }

    /**
     * Index a single symbol with embedding
     */
    async indexSymbol(symbol: CodeSymbol): Promise<void> {
        if (!this.config.enabled) {
            return;
        }

        await this.symbolVectorRepo.indexSymbol(symbol);
        this.indexedSymbolCount++;
    }

    /**
     * Batch index multiple symbols (more efficient)
     */
    async batchIndex(symbols: CodeSymbol[]): Promise<void> {
        if (!this.config.enabled || symbols.length === 0) {
            return;
        }

        await this.symbolVectorRepo.indexSymbols(symbols, this.config.batchSize);
        this.indexedSymbolCount += symbols.length;
    }

    /**
     * Index all symbols from SymbolIndex
     */
    async indexAllSymbols(): Promise<void> {
        if (!this.config.enabled) {
            return;
        }

        this.indexedSymbolCount = 0;
        const allSymbols = await this.extractAllSymbols();
        await this.batchIndex(allSymbols);
        this.lastBuildAt = Date.now();
    }

    async buildIndex(): Promise<{ indexedSymbols: number; removed: number; durationMs: number }> {
        const startedAt = Date.now();
        const cleared = await this.clearIndex();
        await this.indexAllSymbols();
        const vectorConfig = this.vectorIndexManager.getConfig();
        if (this.vectorIndexManager.isEnabled() && vectorConfig.mode !== "bruteforce") {
            await this.vectorIndexManager.rebuildFromRepository(
                this.embeddingProvider.provider,
                this.config.symbolModelKey
            );
        }
        return {
            indexedSymbols: this.indexedSymbolCount,
            removed: cleared.removed,
            durationMs: Date.now() - startedAt
        };
    }

    /**
     * Search for symbols by natural language query
     * 
     * @param query - Natural language description (e.g., "function that calculates total")
     * @param options - Search options
     * @returns Ranked list of matching symbols
     */
    async searchSymbols(
        query: string,
        options: {
            topK?: number;
            minSimilarity?: number;
            symbolTypes?: CodeSymbol['type'][];
        } = {}
    ): Promise<SymbolSearchResult[]> {
        if (!this.config.enabled) {
            return [];
        }

        const topK = options.topK ?? this.config.maxResults;
        const minSimilarity = options.minSimilarity ?? this.config.minSimilarity;

        // Get embedding-based matches
        const results = await this.symbolVectorRepo.searchSymbols(query, topK);

        // Filter by similarity threshold and symbol type
        let filtered = results.results.filter(r => r.similarity >= minSimilarity);

        if (options.symbolTypes && options.symbolTypes.length > 0) {
            filtered = filtered.filter(r => 
                options.symbolTypes!.includes(r.symbol.type)
            );
        }

        // Calculate relevance score (can be enhanced with more signals)
        return filtered.map(r => ({
            ...r,
            relevanceScore: this.calculateRelevanceScore(r.symbol, r.similarity, query),
        }));
    }

    async searchSymbolsWithDiagnostics(
        query: string,
        options: {
            topK?: number;
            minSimilarity?: number;
            symbolTypes?: CodeSymbol['type'][];
        } = {}
    ): Promise<{ results: SymbolSearchResult[]; degraded: boolean; reason?: string; backend?: string }> {
        if (!this.config.enabled) {
            return { results: [], degraded: true, reason: "symbol_semantic_search_disabled" };
        }
        const raw = await this.symbolVectorRepo.searchSymbols(query, options.topK ?? this.config.maxResults);
        if (raw.degraded) {
            return { results: [], degraded: true, reason: raw.reason, backend: raw.backend };
        }
        const filtered = raw.results
            .filter(result => result.similarity >= (options.minSimilarity ?? this.config.minSimilarity))
            .filter(result => !options.symbolTypes || options.symbolTypes.includes(result.symbol.type))
            .map(result => ({
                ...result,
                relevanceScore: this.calculateRelevanceScore(result.symbol, result.similarity, query)
            }));
        return { results: filtered, degraded: false, backend: raw.backend };
    }

    /**
     * Get statistics about indexed symbols
     */
    getStats() {
        return {
            indexedSymbolCount: this.indexedSymbolCount,
            enabled: this.config.enabled,
            config: this.config,
            lastBuildAt: this.lastBuildAt
        };
    }

    getStatus() {
        const vectorConfig = this.vectorIndexManager.getConfig();
        return {
            enabled: this.config.enabled,
            mode: this.config.mode,
            provider: this.embeddingProvider.provider,
            baseModel: this.embeddingProvider.model,
            symbolModelKey: this.config.symbolModelKey,
            indexedSymbolCount: this.indexedSymbolCount,
            lastBuildAt: this.lastBuildAt ? new Date(this.lastBuildAt).toISOString() : undefined,
            vectorIndex: {
                enabled: this.vectorIndexManager.isEnabled(),
                mode: vectorConfig.mode,
                rebuild: vectorConfig.rebuild
            }
        };
    }

    async clearIndex(): Promise<{ removed: number }> {
        const result = await this.symbolVectorRepo.clearIndex();
        this.indexedSymbolCount = 0;
        this.lastBuildAt = undefined;
        return result;
    }

    /**
     * Extract all symbols from SymbolIndex and convert to CodeSymbol format
     */
    private async extractAllSymbols(): Promise<CodeSymbol[]> {
        const symbols: CodeSymbol[] = [];
        const allSymbols = await this.symbolIndex.getAllSymbols();
        for (const [filePath, fileSymbols] of allSymbols.entries()) {
            for (const symbol of fileSymbols ?? []) {
                if (!isDefinitionSymbol(symbol)) continue;
                const normalized = this.normalizeSymbolType(symbol.type);
                if (!normalized) continue;
                const content = typeof symbol.content === "string"
                    ? symbol.content
                    : (typeof symbol.doc === "string" ? symbol.doc : undefined);
                const trimmedContent = content
                    ? content.slice(0, this.config.maxTextChars)
                    : undefined;
                const codeSymbol: CodeSymbol = {
                    symbolId: SymbolVectorRepository.buildSymbolId({
                        filePath,
                        name: symbol.name,
                        type: normalized,
                        lineRange: { start: symbol.range.startLine, end: symbol.range.endLine },
                        range: { startByte: symbol.range.startByte, endByte: symbol.range.endByte },
                        signature: symbol.signature,
                        content: trimmedContent
                    }),
                    name: symbol.name,
                    type: normalized,
                    filePath,
                    lineRange: { start: symbol.range.startLine, end: symbol.range.endLine },
                    range: { startByte: symbol.range.startByte, endByte: symbol.range.endByte },
                    signature: symbol.signature,
                    content: trimmedContent
                };
                symbols.push(codeSymbol);
            }
        }
        return symbols;
    }

    /**
     * Normalize SymbolIndex kind to CodeSymbol type
     */
    private normalizeSymbolType(kind: string): CodeSymbol['type'] | null {
        const normalized = kind.toLowerCase();
        if (normalized === "class") return "class";
        if (normalized === "function") return "function";
        if (normalized === "method") return "method";
        if (normalized === "interface") return "interface";
        if (normalized === "type_alias") return "type";
        return null;
    }

    /**
     * Calculate relevance score combining multiple signals
     */
    private calculateRelevanceScore(
        symbol: CodeSymbol,
        similarity: number,
        query: string
    ): number {
        let score = similarity;

        // Boost exact name matches
        const queryLower = query.toLowerCase();
        const nameLower = symbol.name.toLowerCase();
        
        if (nameLower === queryLower) {
            score *= 1.5;
        } else if (nameLower.includes(queryLower) || queryLower.includes(nameLower)) {
            score *= 1.2;
        }

        // Boost by symbol type (classes and interfaces are typically more important)
        if (symbol.type === 'class' || symbol.type === 'interface') {
            score *= 1.1;
        }

        return Math.min(score, 1.0);
    }
}

function isDefinitionSymbol(symbol: SymbolInfo): symbol is DefinitionSymbol {
    return symbol.type !== "import" && symbol.type !== "export";
}
