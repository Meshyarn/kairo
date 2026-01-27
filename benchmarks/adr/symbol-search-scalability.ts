import { performance } from "perf_hooks";
import { MemoryIndexStore } from "../src/storage/IndexStore.js";

type SymbolInfo = { name: string; kind?: string; signature?: string; range?: any; content?: string };

function makeSymbols(prefix: string, count: number): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    for (let i = 0; i < count; i++) {
        symbols.push({ name: `${prefix}Symbol${i}`, kind: "symbol" });
    }
    return symbols;
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function runSearch(store: MemoryIndexStore, pattern: string, iterations: number): { p50: number; p95: number; p99: number } {
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        store.searchSymbols(pattern, 50);
        samples.push(performance.now() - start);
    }
    return {
        p50: percentile(samples, 50),
        p95: percentile(samples, 95),
        p99: percentile(samples, 99)
    };
}

function bootstrapStore({ secondaryIndex }: { secondaryIndex: boolean }): MemoryIndexStore {
    process.env.KAIRO_SYMBOL_SECONDARY_INDEX = secondaryIndex ? "on" : "off";
    const store = new MemoryIndexStore(process.cwd());
    const fileCount = 2500;
    const symbolsPerFile = 40;
    for (let i = 0; i < fileCount; i++) {
        const filePath = `src/generated/file${i}.ts`;
        store.replaceSymbols({
            relativePath: filePath,
            lastModified: Date.now(),
            language: "ts",
            symbols: makeSymbols(`File${i}_`, symbolsPerFile)
        });
    }
    return store;
}

function main() {
    const query = "File1200_Symbol12";
    const pattern = `%${query}%`;
    const iterations = 30;

    console.log("==========================================================");
    console.log("🏁 Symbol search scalability (ADR-069)");
    console.log("==========================================================");
    console.log(`dataset: files=2500, symbolsPerFile=40, totalSymbols=100000`);
    console.log(`query: ${query} (pattern=${pattern})`);
    console.log(`iterations: ${iterations}`);

    const storeWithSecondary = bootstrapStore({ secondaryIndex: true });
    const withSecondary = runSearch(storeWithSecondary, pattern, iterations);
    console.log("\n[secondary index: on]");
    console.log(withSecondary);

    const storeLinear = bootstrapStore({ secondaryIndex: false });
    const linear = runSearch(storeLinear, pattern, iterations);
    console.log("\n[secondary index: off]");
    console.log(linear);
}

main();

