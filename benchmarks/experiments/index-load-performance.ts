import { performance } from "perf_hooks";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ProjectIndexManager } from "../src/indexing/ProjectIndexManager.js";
import { PathManager } from "../src/utils/PathManager.js";

interface BenchStats {
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
}

interface MemoryStats {
    avgMb: number;
    maxMb: number;
}

const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
};

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "index-load-perf-"));

const createIndex = async (root: string, repoId: string, fileCount: number) => {
    const repoPath = path.join(root, repoId);
    fs.mkdirSync(repoPath, { recursive: true });
    PathManager.setRoot(root, repoId);
    const manager = new ProjectIndexManager(repoPath);
    const index = manager.createEmptyIndex();

    for (let i = 0; i < fileCount; i += 1) {
        const filePath = path.join(repoPath, "src", `file${i}.ts`);
        const entry = {
            mtime: Date.now(),
            language: "typescript",
            symbols: [{ name: `Symbol${i}`, kind: "function", range: { startLine: 1, endLine: 1 } }],
            imports: []
        };
        manager.updateFileEntry(index, filePath, entry as any);
    }

    await manager.persistIndex(index);
};

async function run(): Promise<void> {
    const iterations = Number.parseInt(process.env.SMART_CONTEXT_INDEX_LOAD_ITERATIONS ?? "20", 10);
    const fileCount = Number.parseInt(process.env.SMART_CONTEXT_INDEX_LOAD_FILES ?? "1000", 10);
    const root = createTempDir();
    const repoIds = ["repo-a", "repo-b", "repo-c"];

    for (const repoId of repoIds) {
        await createIndex(root, repoId, fileCount);
    }

    const loadTimesByRepo = new Map<string, number[]>();
    const memoryByRepo = new Map<string, number[]>();
    repoIds.forEach(repoId => {
        loadTimesByRepo.set(repoId, []);
        memoryByRepo.set(repoId, []);
    });

    for (let i = 0; i < iterations; i += 1) {
        for (const repoId of repoIds) {
            const repoPath = path.join(root, repoId);
            PathManager.setRoot(root, repoId);
            const manager = new ProjectIndexManager(repoPath);
            const before = process.memoryUsage().heapUsed;
            const start = performance.now();
            await manager.loadPersistedIndex();
            const elapsed = performance.now() - start;
            const after = process.memoryUsage().heapUsed;

            loadTimesByRepo.get(repoId)?.push(elapsed);
            memoryByRepo.get(repoId)?.push((after - before) / (1024 * 1024));
        }
    }

    const perRepoStats = repoIds.map(repoId => {
        const times = loadTimesByRepo.get(repoId) ?? [];
        const mems = memoryByRepo.get(repoId) ?? [];
        const avgMs = times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length);
        const avgMb = mems.reduce((sum, value) => sum + value, 0) / Math.max(1, mems.length);
        return {
            repoId,
            time: {
                avgMs,
                p50Ms: percentile(times, 50),
                p95Ms: percentile(times, 95)
            },
            memory: {
                avgMb,
                maxMb: mems.length ? Math.max(...mems) : 0
            }
        };
    });

    const allTimes = repoIds.flatMap(repoId => loadTimesByRepo.get(repoId) ?? []);
    const allMems = repoIds.flatMap(repoId => memoryByRepo.get(repoId) ?? []);
    const overallTime: BenchStats = {
        avgMs: allTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, allTimes.length),
        p50Ms: percentile(allTimes, 50),
        p95Ms: percentile(allTimes, 95)
    };
    const overallMemory: MemoryStats = {
        avgMb: allMems.reduce((sum, value) => sum + value, 0) / Math.max(1, allMems.length),
        maxMb: allMems.length ? Math.max(...allMems) : 0
    };

    const reportLines = [
        "# Index Load Performance Benchmark",
        "",
        `Repos: ${repoIds.length}`,
        `Files per repo: ${fileCount}`,
        `Iterations: ${iterations}`,
        "",
        "## Overall",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        `| Avg load time (ms) | ${overallTime.avgMs.toFixed(2)} |`,
        `| P50 load time (ms) | ${overallTime.p50Ms.toFixed(2)} |`,
        `| P95 load time (ms) | ${overallTime.p95Ms.toFixed(2)} |`,
        `| Avg heap delta (MB) | ${overallMemory.avgMb.toFixed(2)} |`,
        `| Max heap delta (MB) | ${overallMemory.maxMb.toFixed(2)} |`,
        "",
        "## Per Repo",
        "",
        "| Repo | Avg (ms) | P50 (ms) | P95 (ms) | Avg heap delta (MB) | Max heap delta (MB) |",
        "| --- | --- | --- | --- | --- | --- |",
        ...perRepoStats.map(stat => [
            `| ${stat.repoId}`,
            stat.time.avgMs.toFixed(2),
            stat.time.p50Ms.toFixed(2),
            stat.time.p95Ms.toFixed(2),
            stat.memory.avgMb.toFixed(2),
            stat.memory.maxMb.toFixed(2),
            "|"
        ].join(" | "))
    ];

    const reportDir = path.join(process.cwd(), "benchmarks", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `index-load-performance-${Date.now()}.md`);
    fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

    console.log(reportLines.join("\n"));
    console.log(`\nReport saved to ${reportPath}`);

    PathManager.setRoot(process.cwd());
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(0);
}

run().catch((error) => {
    console.error("Benchmark failed:", error);
    process.exit(1);
});
