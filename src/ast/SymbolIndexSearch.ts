import type { IndexDatabase } from "../indexing/IndexDatabase.js";
import type { SymbolSearchResult } from "./SymbolIndex.js";

export const shouldRunFuzzySearch = (db: IndexDatabase): boolean => {
    const mode = (process.env.KAIRO_SYMBOL_FUZZY_SEARCH ?? "auto").trim().toLowerCase();
    if (mode === "off" || mode === "false") return false;
    if (mode === "on" || mode === "true") return true;
    const maxFilesRaw = Number.parseInt(process.env.KAIRO_SYMBOL_FUZZY_MAX_FILES ?? "2000", 10);
    const maxFiles = Number.isFinite(maxFilesRaw) ? maxFilesRaw : 2000;
    return db.listFiles().length <= maxFiles;
};

export const searchAllSymbolsLinear = (
    db: IndexDatabase,
    query: string,
    limit: number
): SymbolSearchResult[] => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return [];
    }
    const results: SymbolSearchResult[] = [];
    const symbolMap = db.streamAllSymbols();
    for (const [filePath, symbols] of symbolMap) {
        for (const symbol of symbols) {
            const name = symbol?.name;
            if (typeof name !== "string") continue;
            if (!name.toLowerCase().includes(normalizedQuery)) continue;
            results.push({ filePath, symbol });
            if (results.length >= limit) {
                return results;
            }
        }
    }
    return results;
};

export const fuzzySearch = (
    db: IndexDatabase,
    query: string,
    options: { maxEditDistance: number; scoreThreshold?: number }
): SymbolSearchResult[] => {
    const symbolMap = db.streamAllSymbols();
    const candidates: { result: SymbolSearchResult; distance: number; score: number }[] = [];

    for (const [filePath, symbols] of symbolMap) {
        for (const symbol of symbols) {
            const distance = levenshteinDistance(query.toLowerCase(), symbol.name.toLowerCase());
            const score = calculateFuzzyScore(query, symbol.name);

            if (distance <= options.maxEditDistance && (!options.scoreThreshold || score >= options.scoreThreshold)) {
                candidates.push({
                    result: { filePath, symbol },
                    distance,
                    score
                });
            }
        }
    }

    return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, 100)
        .map(candidate => candidate.result);
};

const calculateFuzzyScore = (query: string, symbolName: string): number => {
    const distance = levenshteinDistance(
        query.toLowerCase(),
        symbolName.toLowerCase()
    );
    const maxLength = Math.max(query.length, symbolName.length);
    const similarity = 1 - (distance / maxLength);

    const prefixBoost = symbolName.toLowerCase().startsWith(query.toLowerCase()) ? 0.2 : 0;
    const exactBoost = query.toLowerCase() === symbolName.toLowerCase() ? 0.3 : 0;

    return Math.min(1.0, similarity + prefixBoost + exactBoost);
};

const levenshteinDistance = (a: string, b: string): number => {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
};
