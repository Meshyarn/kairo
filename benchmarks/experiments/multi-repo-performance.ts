import { performance } from "perf_hooks";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RepoRegistry } from "../src/config/RepoRegistry.js";
import { MultiRepoIndexCoordinator } from "../src/indexing/MultiRepoIndexCoordinator.js";
import { PathManager } from "../src/utils/PathManager.js";

interface BenchStats {
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
}

const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
};

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "multi-repo-perf-"));

async function run(): Promise<void> {
    const iterations = Number.parseInt(process.env.SMART_CONTEXT_MULTI_REPO_ITERATIONS ?? "50", 10);
    const symbolCount = Number.parseInt(process.env.SMART_CONTEXT_MULTI_REPO_SYMBOLS ?? "200", 10);
    const root = createTempDir();
    const repoA = path.join(root, "repo-a");
    const repoB = path.join(root, "repo-b");
    const repoC = path.join(root, "repo-c");
    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(repoB, { recursive: true });
    fs.mkdirSync(repoC, { recursive: true });

    PathManager.setRoot(root);
    const configDir = path.join(root, ".kairo", "config");
    fs.mkdirSync(configDir, { recursive: true });
    const config = {
        version: "1.0",
        repositories: {
            a: { path: "repo-a", name: "Repo A", type: "primary", languages: ["typescript"] },
            b: { path: "repo-b", name: "Repo B", type: "linked", languages: ["python"] },
            c: { path: "repo-c", name: "Repo C", type: "linked", languages: ["go"] }
        },
        defaultRepo: "a"
    };
    fs.writeFileSync(path.join(configDir, "mcp-config.json"), JSON.stringify(config, null, 2));

    const registry = new RepoRegistry(root);
    const coordinator = new MultiRepoIndexCoordinator(registry);
    const dbs = (coordinator as any).indexDatabases as Map<string, any>;
    const dbA = dbs.get("a");
    const dbB = dbs.get("b");
    const dbC = dbs.get("c");

    for (let i = 0; i < symbolCount; i += 1) {
        dbA.replaceSymbols({
            relativePath: `src/a${i}.ts`,
            lastModified: Date.now(),
            language: "typescript",
            symbols: [{ name: `Symbol${i}`, kind: "function", range: { startLine: 1, endLine: 1 } }]
        });
        dbB.replaceSymbols({
            relativePath: `src/b${i}.py`,
            lastModified: Date.now(),
            language: "python",
            symbols: [{ name: `Symbol${i}`, kind: "function", range: { startLine: 1, endLine: 1 } }]
        });
        dbC.replaceSymbols({
            relativePath: `src/c${i}.go`,
            lastModified: Date.now(),
            language: "go",
            symbols: [{ name: `Symbol${i}`, kind: "function", range: { startLine: 1, endLine: 1 } }]
        });
    }

    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
        coordinator.searchSymbolsAcrossRepos(`Symbol${symbolCount - 1}`, { limit: 10 });
    }
    for (let i = 0; i < iterations; i += 1) {
        const start = performance.now();
        coordinator.searchSymbolsAcrossRepos(`Symbol${symbolCount - 1}`, { limit: 10 });
        times.push(performance.now() - start);
    }

    const total = times.reduce((sum, value) => sum + value, 0);
    const stats: BenchStats = {
        avgMs: total / iterations,
        p50Ms: percentile(times, 50),
        p95Ms: percentile(times, 95)
    };

    const reportLines = [
        "# Multi-Repo Symbol Search Benchmark",
        "",
        "Repos: 3",
        `Symbols per repo: ${symbolCount}`,
        `Iterations: ${iterations}`,
        "",
        "| Metric | Value (ms) |",
        "| --- | --- |",
        `| Avg | ${stats.avgMs.toFixed(2)} |`,
        `| P50 | ${stats.p50Ms.toFixed(2)} |`,
        `| P95 | ${stats.p95Ms.toFixed(2)} |`
    ];

    const reportDir = path.join(process.cwd(), "benchmarks", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `multi-repo-performance-${Date.now()}.md`);
    fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

    console.log(reportLines.join("\n"));
    console.log(`\nReport saved to ${reportPath}`);

    registry.dispose();
    PathManager.setRoot(process.cwd());
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(0);
}

run().catch((error) => {
    console.error("Benchmark failed:", error);
    process.exit(1);
});
