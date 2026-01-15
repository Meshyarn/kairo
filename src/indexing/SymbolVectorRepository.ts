import type { VectorIndexManager, VectorItem } from "../vector/VectorIndexManager.js";
import type { EmbeddingProviderClient } from "../embeddings/EmbeddingProviderFactory.js";
import type { SymbolIndex } from "../ast/SymbolIndex.js";
import type { EmbeddingRepository } from "./EmbeddingRepository.js";

/**
 * CodeSymbol interface for Layer 3 Smart Fuzzy Match
 */
export interface CodeSymbol {
    symbolId: string;
    name: string;
    type: 'class' | 'function' | 'method' | 'interface' | 'type';
    filePath: string;
    lineRange: { start: number; end: number };
    range: { startByte: number; endByte: number }; // For indexRange resolution
    signature?: string;
    content?: string; // For embedding
}

/**
 * Symbol search result with similarity score
 */
export interface SymbolWithSimilarity {
    symbol: CodeSymbol;
    similarity: number;
}

export type ParsedSymbolId = {
    filePath: string;
    lineRange: { start: number; end: number };
    type: CodeSymbol["type"];
    name: string;
};

/**
 * Bridge between SymbolIndex and VectorIndexManager
 * Enables embedding-based symbol search for Layer 3
 */
export class SymbolVectorRepository {
    private readonly vectorIndexManager: VectorIndexManager;
    private readonly embeddingProvider: EmbeddingProviderClient;
    private readonly symbolIndex: SymbolIndex;
    private readonly embeddingRepository: EmbeddingRepository;
    private readonly provider: string;
    private readonly model: string;

    constructor(
        vectorIndexManager: VectorIndexManager,
        embeddingProvider: EmbeddingProviderClient,
        symbolIndex: SymbolIndex,
        embeddingRepository: EmbeddingRepository,
        options: { provider: string; model: string }
    ) {
        this.vectorIndexManager = vectorIndexManager;
        this.embeddingProvider = embeddingProvider;
        this.symbolIndex = symbolIndex;
        this.embeddingRepository = embeddingRepository;
        this.provider = options.provider;
        this.model = options.model;
    }

    /**
     * Index a single symbol with embedding
     */
    async indexSymbol(symbol: CodeSymbol): Promise<void> {
        // Generate text for embedding: "function_name signature"
        const textForEmbedding = this.buildSymbolText(symbol);
        
        // Get embedding
        const embeddings = await this.embeddingProvider.embed([textForEmbedding]);
        if (embeddings.length === 0) {
            throw new Error(`Failed to generate embedding for symbol: ${symbol.symbolId}`);
        }
        const vector = embeddings[0];
        if (!vector || vector.length === 0) {
            throw new Error(`Empty embedding for symbol: ${symbol.symbolId}`);
        }
        this.embeddingRepository.upsertEmbedding(symbol.symbolId, {
            provider: this.provider,
            model: this.model,
            dims: vector.length,
            vector
        });

        // Create VectorItem
        const item: VectorItem = {
            id: symbol.symbolId,
            metadata: {
                type: 'symbol',
                filePath: symbol.filePath,
                lineRange: symbol.lineRange,
                symbolType: symbol.type,
                symbolName: symbol.name,
                signature: symbol.signature,
            },
            embedding: {
                provider: this.provider,
                model: this.model,
                dims: vector.length,
                vector
            },
        };

        // Index via VectorIndexManager
        this.vectorIndexManager.indexItem(item);
    }

    /**
     * Batch index symbols (optimized for performance)
     */
    async indexSymbols(symbols: CodeSymbol[], batchSize = 10): Promise<void> {
        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            const texts = batch.map(s => this.buildSymbolText(s));
            
            // Batch embedding for efficiency
            const embeddings = await this.embeddingProvider.embed(texts);
            
            // Index each symbol
            for (let j = 0; j < batch.length; j++) {
                const symbol = batch[j];
                const embedding = embeddings[j];
                
                if (!embedding) continue;
                this.embeddingRepository.upsertEmbedding(symbol.symbolId, {
                    provider: this.provider,
                    model: this.model,
                    dims: embedding.length,
                    vector: embedding
                });
                
                const item: VectorItem = {
                    id: symbol.symbolId,
                    metadata: {
                        type: 'symbol',
                        filePath: symbol.filePath,
                        lineRange: symbol.lineRange,
                        symbolType: symbol.type,
                        symbolName: symbol.name,
                        signature: symbol.signature,
                    },
                    embedding: {
                        provider: this.provider,
                        model: this.model,
                        dims: embedding.length,
                        vector: embedding,
                    },
                };
                
                this.vectorIndexManager.indexItem(item);
            }
        }
    }

    /**
     * Search symbols by natural language query
     */
    async searchSymbols(query: string, topK = 3): Promise<{ results: SymbolWithSimilarity[]; degraded: boolean; reason?: string; backend?: string }> {
        // Embed query
        const queryEmbeddings = await this.embeddingProvider.embed([query]);
        if (queryEmbeddings.length === 0) {
            return { results: [], degraded: true, reason: "embedding_provider_disabled" };
        }

        // Search via VectorIndexManager
        const results = await this.vectorIndexManager.search(queryEmbeddings[0], {
            provider: this.provider,
            model: this.model,
            k: topK,
        });

        if (results.degraded || results.ids.length === 0) {
            return { results: [], degraded: true, reason: results.reason ?? "vector_index_unavailable", backend: results.backend };
        }

        const parsed = results.ids.map((id) => this.parseSymbolId(id)).map((parsedSymbol, index) => {
            if (!parsedSymbol) {
                return {
                    symbol: {
                        symbolId: results.ids[index],
                        name: results.ids[index],
                        type: "function" as const,
                        filePath: results.ids[index],
                        lineRange: { start: 0, end: 0 },
                        range: { startByte: 0, endByte: 0 }
                    },
                    similarity: results.scores.get(results.ids[index]) ?? 0
                };
            }
            return {
                symbol: {
                    symbolId: results.ids[index],
                    name: parsedSymbol.name,
                    type: parsedSymbol.type,
                    filePath: parsedSymbol.filePath,
                    lineRange: parsedSymbol.lineRange,
                    range: { startByte: 0, endByte: 0 }
                },
                similarity: results.scores.get(results.ids[index]) ?? 0
            };
        });
        return { results: parsed, degraded: false, backend: results.backend };
    }

    /**
     * Update a symbol (re-index with new embedding)
     */
    async updateSymbol(symbolId: string, symbol: CodeSymbol): Promise<void> {
        // Remove old version
        this.vectorIndexManager.removeChunk(symbolId);
        
        // Index new version
        await this.indexSymbol(symbol);
    }

    /**
     * Remove a symbol from index
     */
    removeSymbol(symbolId: string): void {
        this.vectorIndexManager.removeChunk(symbolId);
    }

    async clearIndex(): Promise<{ removed: number }> {
        let removed = 0;
        this.embeddingRepository.iterateEmbeddings(this.provider, this.model, (embedding) => {
            this.vectorIndexManager.removeChunk(embedding.chunkId);
            this.embeddingRepository.deleteEmbedding(embedding.chunkId);
            removed += 1;
        });
        return { removed };
    }

    public buildSymbolId(symbol: Omit<CodeSymbol, "symbolId">): string {
        return SymbolVectorRepository.buildSymbolId(symbol);
    }

    public parseSymbolId(symbolId: string): ParsedSymbolId | null {
        return SymbolVectorRepository.parseSymbolId(symbolId);
    }

    static buildSymbolId(symbol: Omit<CodeSymbol, "symbolId">): string {
        const encodedPath = base64UrlEncode(symbol.filePath);
        const encodedName = base64UrlEncode(symbol.name);
        return `sym:v1:${encodedPath}:${symbol.lineRange.start}:${symbol.lineRange.end}:${symbol.type}:${encodedName}`;
    }

    static parseSymbolId(symbolId: string): ParsedSymbolId | null {
        if (!symbolId || !symbolId.startsWith("sym:v1:")) return null;
        const parts = symbolId.split(":");
        if (parts.length < 7) return null;
        const filePath = base64UrlDecode(parts[2]);
        const startLine = Number(parts[3]);
        const endLine = Number(parts[4]);
        const type = parts[5] as CodeSymbol["type"];
        const name = base64UrlDecode(parts[6]);
        if (!filePath || !name || !Number.isFinite(startLine) || !Number.isFinite(endLine)) {
            return null;
        }
        return {
            filePath,
            lineRange: { start: startLine, end: endLine },
            type,
            name
        };
    }

    /**
     * Build text representation of symbol for embedding
     * Format: "type name signature"
     */
    private buildSymbolText(symbol: CodeSymbol): string {
        const parts: string[] = [];
        
        // Include type
        parts.push(symbol.type);
        
        // Include name
        parts.push(symbol.name);
        
        // Include signature if available
        if (symbol.signature) {
            parts.push(symbol.signature);
        }
        
        // Include content if available (for better context)
        if (symbol.content) {
            parts.push(symbol.content);
        }
        
        return parts.join(' ');
    }
}

function base64UrlEncode(value: string): string {
    return Buffer.from(value, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
}
