import type { SymbolInfo } from "../../types.js";
import { normalizeLikePattern } from "./IndexCache.js";

type SymbolStoreState = {
    normalize: (value: string) => string;
    symbols: Map<string, SymbolInfo[]>;
    symbolRefsByTrigram: Map<string, Set<string>>;
    symbolSecondaryIndexEnabled: boolean;
    symbolSecondaryIndexBytes: number;
    resolveSymbolSearchMaxCandidates: () => number;
};

export const replaceSymbols = (
    store: SymbolStoreState,
    args: { relativePath: string; lastModified: number; language?: string | null; symbols: SymbolInfo[] },
    onGetOrCreateFile: (relativePath: string, lastModified?: number, language?: string | null) => void
): void => {
    const normalized = store.normalize(args.relativePath);
    removeSecondaryIndexForFile(store, normalized);
    onGetOrCreateFile(normalized, args.lastModified, args.language);
    store.symbols.set(normalized, [...(args.symbols ?? [])]);
    addSecondaryIndexForFile(store, normalized, args.symbols ?? []);
};

export const readSymbols = (store: SymbolStoreState, relativePath: string): SymbolInfo[] | undefined => {
    const normalized = store.normalize(relativePath);
    const stored = store.symbols.get(normalized);
    return stored ? stored.map(symbol => ({ ...symbol })) : undefined;
};

export const streamAllSymbols = (store: SymbolStoreState): Map<string, SymbolInfo[]> => {
    const map = new Map<string, SymbolInfo[]>();
    for (const [key, symbols] of store.symbols.entries()) {
        map.set(key, symbols.map(symbol => ({ ...symbol })));
    }
    return map;
};

export const searchSymbols = (
    store: SymbolStoreState,
    pattern: string,
    limit: number = 100
): Array<{ path: string; data_json: string }> => {
    const query = normalizeLikePattern(pattern);
    if (!query) return [];
    if (!store.symbolSecondaryIndexEnabled || query.length < 3) {
        return searchSymbolsLinear(store, query, limit);
    }
    if (store.symbolRefsByTrigram.size === 0) {
        return searchSymbolsLinear(store, query, limit);
    }
    const candidates = collectSecondaryCandidates(store, query);
    if (!candidates) {
        return searchSymbolsLinear(store, query, limit);
    }
    const cap = store.resolveSymbolSearchMaxCandidates();
    const sliced = cap > 0 && candidates.length > cap ? candidates.slice(0, cap) : candidates;
    const results: Array<{ path: string; data_json: string }> = [];
    for (const ref of sliced) {
        const resolved = resolveSymbolRef(store, ref);
        if (!resolved?.symbol?.name) continue;
        if (!resolved.symbol.name.toLowerCase().includes(query)) continue;
        results.push({ path: resolved.filePath, data_json: JSON.stringify(resolved.symbol) });
        if (results.length >= limit) {
            return results;
        }
    }
    return results;
};

export const getSecondaryIndexStatus = (store: SymbolStoreState): { enabled: boolean; bytes?: number } => {
    return {
        enabled: store.symbolSecondaryIndexEnabled,
        bytes: store.symbolSecondaryIndexBytes
    };
};

export const rebuildSecondaryIndex = (store: SymbolStoreState): void => {
    if (!store.symbolSecondaryIndexEnabled) {
        store.symbolRefsByTrigram.clear();
        return;
    }
    store.symbolRefsByTrigram.clear();
    for (const [filePath, symbols] of store.symbols.entries()) {
        addSecondaryIndexForFile(store, filePath, symbols);
    }
};

const searchSymbolsLinear = (
    store: SymbolStoreState,
    query: string,
    limit: number
): Array<{ path: string; data_json: string }> => {
    const results: Array<{ path: string; data_json: string }> = [];
    for (const [filePath, symbols] of store.symbols.entries()) {
        for (const symbol of symbols) {
            if (!symbol?.name) continue;
            if (!symbol.name.toLowerCase().includes(query)) continue;
            results.push({ path: filePath, data_json: JSON.stringify(symbol) });
            if (results.length >= limit) {
                return results;
            }
        }
    }
    return results;
};

const collectSecondaryCandidates = (store: SymbolStoreState, query: string): string[] | null => {
    const trigrams = toTrigrams(query);
    if (trigrams.length === 0) return null;
    const sets: Set<string>[] = [];
    for (const trigram of trigrams) {
        const set = store.symbolRefsByTrigram.get(trigram);
        if (!set || set.size === 0) {
            return [];
        }
        sets.push(set);
    }
    sets.sort((a, b) => a.size - b.size);
    let candidates = new Set(sets[0]);
    for (let i = 1; i < sets.length; i++) {
        const next = sets[i];
        for (const ref of candidates) {
            if (!next.has(ref)) {
                candidates.delete(ref);
            }
        }
        if (candidates.size === 0) break;
    }
    return Array.from(candidates);
};

const resolveSymbolRef = (store: SymbolStoreState, ref: string): { filePath: string; symbol: SymbolInfo } | null => {
    const splitIndex = ref.lastIndexOf("#");
    if (splitIndex <= 0) return null;
    const filePath = ref.slice(0, splitIndex);
    const ordinal = Number.parseInt(ref.slice(splitIndex + 1), 10);
    if (!Number.isFinite(ordinal) || ordinal < 0) return null;
    const symbols = store.symbols.get(filePath);
    const symbol = symbols?.[ordinal];
    if (!symbol) return null;
    return { filePath, symbol };
};

const addSecondaryIndexForFile = (store: SymbolStoreState, filePath: string, symbols: SymbolInfo[]): void => {
    if (!store.symbolSecondaryIndexEnabled) return;
    symbols.forEach((symbol, index) => {
        if (!symbol?.name) return;
        const ref = buildSymbolRef(filePath, index);
        const trigrams = toTrigrams(symbol.name.toLowerCase());
        if (trigrams.length === 0) return;
        for (const trigram of trigrams) {
            let set = store.symbolRefsByTrigram.get(trigram);
            if (!set) {
                set = new Set();
                store.symbolRefsByTrigram.set(trigram, set);
            }
            set.add(ref);
        }
    });
};

export const removeSecondaryIndexForFile = (store: SymbolStoreState, filePath: string): void => {
    if (!store.symbolSecondaryIndexEnabled) return;
    const symbols = store.symbols.get(filePath) ?? [];
    symbols.forEach((symbol, index) => {
        if (!symbol?.name) return;
        const ref = buildSymbolRef(filePath, index);
        const trigrams = toTrigrams(symbol.name.toLowerCase());
        for (const trigram of trigrams) {
            const set = store.symbolRefsByTrigram.get(trigram);
            if (!set) continue;
            set.delete(ref);
            if (set.size === 0) {
                store.symbolRefsByTrigram.delete(trigram);
            }
        }
    });
};

const toTrigrams = (input: string): string[] => {
    const normalized = input.trim().toLowerCase();
    if (normalized.length < 3) return [];
    if (normalized.length === 3) return [normalized];
    const trigrams: string[] = [];
    for (let i = 0; i <= normalized.length - 3; i++) {
        trigrams.push(normalized.slice(i, i + 3));
    }
    return trigrams;
};

const buildSymbolRef = (filePath: string, ordinal: number): string => {
    return `${filePath}#${ordinal}`;
};
