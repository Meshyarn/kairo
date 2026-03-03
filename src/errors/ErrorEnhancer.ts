import { SymbolIndex } from '../ast/SymbolIndex.js';
import { EnhancedErrorDetails, ToolSuggestion } from '../types.js';

/** Inline recovery strategies (formerly in AgentPlaybook.ts) */
const RECOVERY_STRATEGIES: Record<string, { toolName: string; rationale: string; exampleArgs?: Record<string, unknown> }> = {
    AMBIGUOUS_MATCH: {
        toolName: "kairo_search",
        rationale: "Re-search with a more specific query to disambiguate.",
        exampleArgs: { query: "" },
    },
    NO_MATCH: {
        toolName: "kairo_search",
        rationale: "Search for the file to inspect its current content before retrying.",
        exampleArgs: { query: "" },
    },
    HASH_MISMATCH: {
        toolName: "kairo_status",
        rationale: "Check index status; the file may have changed on disk.",
        exampleArgs: { action: "check" },
    },
    INDEX_STALE: {
        toolName: "kairo_status",
        rationale: "Trigger reindexing to refresh stale data.",
        exampleArgs: { action: "reindex" },
    },
};

export class ErrorEnhancer {
    /**
     * Enhance "Symbol not found" errors
     */
    static enhanceSymbolNotFound(
        symbolName: string,
        symbolIndex: SymbolIndex
    ): EnhancedErrorDetails {
        const similar = (symbolIndex as any).findSimilar(symbolName, 5) || [];
        
        const suggestions: ToolSuggestion[] = [
            {
                toolName: "kairo_search",
                rationale: "Search for the symbol name to find potential matches.",
                exampleArgs: { query: symbolName },
                priority: "high"
            }
        ];

        // Add recovery strategy
        const strategy = RECOVERY_STRATEGIES.AMBIGUOUS_MATCH;
        suggestions.push({
            toolName: strategy.toolName,
            rationale: strategy.rationale,
            exampleArgs: strategy.exampleArgs,
            priority: "medium"
        });

        return {
            similarSymbols: similar.map((s: any) => s.name),
            nextActionHint: `Symbol '${symbolName}' not found. Try searching or check for typos.`,
            toolSuggestions: suggestions
        };
    }

    /**
     * Enhance "Search not found" errors
     */
    static enhanceSearchNotFound(
        query: string
    ): EnhancedErrorDetails {
        const isLikelyFilename = /^[A-Z0-9-_]+\.(ts|js|tsx|jsx|md|json)$/i.test(query);
        
        const suggestions: ToolSuggestion[] = [];
        
        if (isLikelyFilename) {
            suggestions.push({
                toolName: "kairo_search",
                rationale: "Retry the search with the exact filename to improve matching.",
                exampleArgs: { query },
                priority: "high"
            });
        }

        return {
            nextActionHint: `No results found for '${query}'. Try adjusting your search type or query.`,
            toolSuggestions: suggestions
        };
    }

    /**
     * Enhance "Edit target not found" (NO_MATCH) errors
     */
    static enhanceNoMatch(filePath: string, targetString?: string): EnhancedErrorDetails {
        const strategy = RECOVERY_STRATEGIES.NO_MATCH;
        const suggestions: ToolSuggestion[] = [];

        suggestions.push({
            toolName: strategy.toolName,
            rationale: strategy.rationale,
            exampleArgs: { ...strategy.exampleArgs, filePath },
            priority: "high"
        });

        return {
            nextActionHint: `Target block not found in ${filePath}. Search for the file to verify the current content.`,
            toolSuggestions: suggestions
        };
    }

    /**
     * Enhance "Hash mismatch" errors
     */
    static enhanceHashMismatch(filePath: string): EnhancedErrorDetails {
        const strategy = RECOVERY_STRATEGIES.HASH_MISMATCH;
        const suggestions: ToolSuggestion[] = [];

        suggestions.push({
            toolName: strategy.toolName,
            rationale: strategy.rationale,
            exampleArgs: { ...strategy.exampleArgs },
            priority: "high"
        });

        return {
            nextActionHint: `File ${filePath} has changed since it was last read. Check index status.`,
            toolSuggestions: suggestions
        };
    }

    /**
     * Enhance "Index stale" errors
     */
    static enhanceIndexStale(): EnhancedErrorDetails {
        const strategy = RECOVERY_STRATEGIES.INDEX_STALE;
        const suggestions: ToolSuggestion[] = [];

        suggestions.push({
            toolName: strategy.toolName,
            rationale: strategy.rationale,
            exampleArgs: strategy.exampleArgs,
            priority: "medium"
        });

        return {
            nextActionHint: "The project index may be outdated. Check index status or wait for reindexing.",
            toolSuggestions: suggestions
        };
    }
}
