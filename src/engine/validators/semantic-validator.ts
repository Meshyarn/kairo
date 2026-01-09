import { Query } from "web-tree-sitter";
import levenshtein from "fast-levenshtein";
import { AstManager } from "../../ast/AstManager.js";
import { IndexDatabase } from "../../indexing/IndexDatabase.js";
import type { SymbolInfo } from "../../types.js";
import type { ValidationDiagnostic, ValidationResult } from "../../types/validation.js";

const MAX_SNIPPET_LENGTH = 80;
const MAX_SUGGESTIONS = 3;
const MIN_SIMILARITY = 0.78;
const MIN_IDENTIFIER_LENGTH = 2;

const RESERVED_IDENTIFIERS = new Set([
    "this",
    "super",
    "constructor",
    "prototype",
    "undefined",
    "null",
    "true",
    "false",
    "console",
    "Math",
    "JSON",
    "String",
    "Number",
    "Boolean",
    "Array",
    "Object",
    "Date",
    "Promise",
    "Map",
    "Set",
    "Symbol",
    "Intl",
    "BigInt"
]);

type IdentifierOccurrence = {
    name: string;
    line: number;
    column: number;
    snippet: string;
};

export class SemanticValidator {
    private readonly astManager: AstManager;
    private readonly indexDatabase: IndexDatabase;
    private readonly rootPath: string;

    constructor(options: { rootPath?: string; astManager?: AstManager; indexDatabase?: IndexDatabase } = {}) {
        this.rootPath = options.rootPath ?? process.cwd();
        this.astManager = options.astManager ?? AstManager.getInstance();
        this.indexDatabase = options.indexDatabase ?? new IndexDatabase(this.rootPath);
    }

    async validate(filePath: string, content: string): Promise<ValidationResult> {
        const startTime = performance.now();
        if (!this.astManager.supportsQueries()) {
            return { success: true, durationMs: performance.now() - startTime };
        }
        let doc: any;
        try {
            doc = await this.astManager.parseFile(filePath, content);
            const rootNode = doc?.rootNode;
            if (!this.supportsTreeSitter(rootNode)) {
                return { success: true, durationMs: performance.now() - startTime };
            }

            const identifiers = this.extractIdentifiers(rootNode, content);
            if (identifiers.length === 0) {
                return { success: true, durationMs: performance.now() - startTime };
            }

            const { knownSymbols, localSymbols } = await this.collectKnownSymbols(filePath, content);
            const diagnostics = this.findUnknownSymbols(filePath, identifiers, knownSymbols, localSymbols);
            const durationMs = performance.now() - startTime;

            if (diagnostics.length === 0) {
                return { success: true, durationMs };
            }

            return {
                success: false,
                blockingErrors: diagnostics,
                durationMs
            };
        } catch (error: any) {
            const durationMs = performance.now() - startTime;
            const message = typeof error?.message === "string" ? error.message : "";
            if (this.shouldSkipError(message)) {
                return { success: true, durationMs };
            }
            return {
                success: false,
                blockingErrors: [{
                    filePath,
                    message: `Semantic validation failed: ${message || "Unknown error"}`,
                    provider: "semantic",
                    severity: "warning"
                }],
                durationMs
            };
        } finally {
            doc?.dispose?.();
        }
    }

    private supportsTreeSitter(node: any): boolean {
        return Boolean(node && node.tree && node.startPosition && node.endPosition);
    }

    private shouldSkipError(message: string): boolean {
        const normalized = message.toLowerCase();
        return normalized.includes("unsupported language")
            || normalized.includes("failed to load language")
            || normalized.includes("failed to initialize ast backend")
            || normalized.includes("snapshot not found");
    }

    private extractIdentifiers(rootNode: any, content: string): IdentifierOccurrence[] {
        const lang = rootNode?.tree?.language;
        if (!lang) {
            return [];
        }

        const occurrences: IdentifierOccurrence[] = [];
        const querySources = [
            `
                (identifier) @id
                (property_identifier) @id
                (field_identifier) @id
                (type_identifier) @id
                (shorthand_property_identifier_pattern) @id
            `,
            `
                (identifier) @id
            `
        ];

        let matches: Array<{ captures: Array<{ node: any }> }> = [];
        for (const source of querySources) {
            try {
                const query = new Query(lang, source);
                matches = query.matches(rootNode);
                break;
            } catch {
                continue;
            }
        }
        if (matches.length === 0) {
            return occurrences;
        }

        for (const match of matches) {
            const node = match.captures[0]?.node;
            const name = node?.text;
            if (!name || this.shouldSkipIdentifier(name) || !this.shouldIncludeIdentifier(node)) {
                continue;
            }
            const start = node.startPosition ?? { row: 0, column: 0 };
            const snippet = content.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + MAX_SNIPPET_LENGTH));
            occurrences.push({
                name,
                line: start.row + 1,
                column: start.column + 1,
                snippet: snippet.trim()
            });
        }

        return occurrences;
    }

    private shouldSkipIdentifier(name: string): boolean {
        if (name.length < MIN_IDENTIFIER_LENGTH) {
            return true;
        }
        if (RESERVED_IDENTIFIERS.has(name)) {
            return true;
        }
        if (/^\d+$/.test(name)) {
            return true;
        }
        return false;
    }

    private shouldIncludeIdentifier(node: any): boolean {
        const type = typeof node?.type === "string" ? node.type : "";
        if (type === "property_identifier" || type === "field_identifier") {
            return this.isReferenceContext(node);
        }
        if (type === "shorthand_property_identifier_pattern") {
            return false;
        }
        return true;
    }

    private isReferenceContext(node: any): boolean {
        const parentType = typeof node?.parent?.type === "string" ? node.parent.type : "";
        if (!parentType) {
            return true;
        }
        const normalized = parentType.toLowerCase();
        return normalized.includes("expression")
            || normalized.includes("access")
            || normalized.includes("selector")
            || normalized.includes("member")
            || normalized.includes("call");
    }

    private async collectKnownSymbols(
        filePath: string,
        content: string
    ): Promise<{ knownSymbols: Set<string>; localSymbols: Set<string> }> {
        const known = new Set<string>();
        const local = new Set<string>();

        const symbolMap = this.indexDatabase.streamAllSymbols();
        for (const symbols of symbolMap.values()) {
            for (const symbol of symbols) {
                this.collectSymbolNames(symbol, known);
            }
        }

        try {
            const localSymbols = await this.astManager.generateStructureJson(filePath, content);
            for (const symbol of localSymbols) {
                this.collectSymbolNames(symbol, known);
                this.collectSymbolNames(symbol, local);
            }
        } catch {
            // best-effort: local symbols are optional
        }

        return { knownSymbols: known, localSymbols: local };
    }

    private collectSymbolNames(symbol: SymbolInfo, bucket: Set<string>): void {
        if (symbol?.name) {
            bucket.add(symbol.name);
        }

        if (symbol.type === "import") {
            if (symbol.alias) {
                bucket.add(symbol.alias);
            }
            if (symbol.imports) {
                for (const entry of symbol.imports) {
                    if (entry.name) {
                        bucket.add(entry.name);
                    }
                    if (entry.alias) {
                        bucket.add(entry.alias);
                    }
                }
            }
        }

        if (symbol.type === "export") {
            if (symbol.exports) {
                for (const entry of symbol.exports) {
                    if (entry.name) {
                        bucket.add(entry.name);
                    }
                    if (entry.alias) {
                        bucket.add(entry.alias);
                    }
                }
            }
        }

        if (symbol.container) {
            bucket.add(symbol.container);
        }
    }

    private findUnknownSymbols(
        filePath: string,
        identifiers: IdentifierOccurrence[],
        knownSymbols: Set<string>,
        localSymbols: Set<string>
    ): ValidationDiagnostic[] {
        const suggestionCache = new Map<string, string[]>();
        const seen = new Map<string, IdentifierOccurrence>();

        for (const occurrence of identifiers) {
            if (knownSymbols.has(occurrence.name)) {
                continue;
            }
            if (!seen.has(occurrence.name)) {
                seen.set(occurrence.name, occurrence);
            }
        }

        const diagnostics: ValidationDiagnostic[] = [];
        for (const [name, occurrence] of seen.entries()) {
            const candidates = this.getSuggestionCandidates(name, localSymbols, suggestionCache);
            const suggestions = this.findSuggestions(name, candidates);
            diagnostics.push({
                filePath,
                line: occurrence.line,
                column: occurrence.column,
                message: this.buildMessage(name, suggestions),
                code: "UNKNOWN_SYMBOL",
                provider: "semantic",
                severity: "warning",
                snippet: occurrence.snippet
            });
        }
        return diagnostics;
    }

    private buildMessage(name: string, suggestions: string[]): string {
        if (suggestions.length === 0) {
            return `Unknown symbol '${name}'.`;
        }
        return `Unknown symbol '${name}'. Did you mean: ${suggestions.join(", ")}?`;
    }

    private findSuggestions(name: string, candidates: string[]): string[] {
        const lower = name.toLowerCase();
        const scored: Array<{ name: string; score: number }> = [];

        for (const candidate of candidates) {
            const candidateLower = candidate.toLowerCase();
            if (candidateLower === lower) continue;
            if (!this.isSimilarCandidate(lower, candidateLower)) {
                continue;
            }
            const distance = levenshtein.get(lower, candidateLower);
            const maxLen = Math.max(lower.length, candidateLower.length);
            const similarity = maxLen > 0 ? 1 - distance / maxLen : 0;
            if (similarity >= MIN_SIMILARITY) {
                scored.push({ name: candidate, score: similarity });
            }
        }

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_SUGGESTIONS)
            .map(entry => entry.name);
    }

    private getSuggestionCandidates(
        name: string,
        localSymbols: Set<string>,
        cache: Map<string, string[]>
    ): string[] {
        const prefix = name.slice(0, 2).toLowerCase();
        if (!prefix) {
            return Array.from(localSymbols);
        }
        const cached = cache.get(prefix);
        if (cached) {
            return cached;
        }

        const candidates = new Set<string>();
        const rows = this.indexDatabase.searchSymbols(prefix, 200);
        for (const row of rows) {
            try {
                const symbol = JSON.parse(row.data_json) as SymbolInfo;
                this.collectSymbolNames(symbol, candidates);
            } catch {
                // ignore parse failures
            }
        }

        for (const local of localSymbols) {
            if (local.toLowerCase().includes(prefix)) {
                candidates.add(local);
            }
        }

        const resolved = Array.from(candidates);
        cache.set(prefix, resolved);
        return resolved;
    }

    private isSimilarCandidate(target: string, candidate: string): boolean {
        if (!target || !candidate) return false;
        if (candidate.startsWith(target.slice(0, 2))) return true;
        if (candidate.includes(target.slice(0, 2))) return true;
        return Math.abs(candidate.length - target.length) <= 2;
    }
}
