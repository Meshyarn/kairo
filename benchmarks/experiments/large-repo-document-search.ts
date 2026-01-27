import { performance } from "perf_hooks";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SmartContextServer } from "../src/index.js";

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

async function measure(server: SmartContextServer, iterations: number): Promise<BenchStats> {
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
        await (server as any).handleCallTool("document_search", {
            query: "install",
            output: "compact",
            maxResults: 5,
            maxCandidates: 80
        });
    }
    for (let i = 0; i < iterations; i += 1) {
        const start = performance.now();
        await (server as any).handleCallTool("document_search", {
            query: "install",
            output: "compact",
            maxResults: 5,
            maxCandidates: 80
        });
        times.push(performance.now() - start);
    }
    const total = times.reduce((sum, value) => sum + value, 0);
    return {
        avgMs: total / iterations,
        p50Ms: percentile(times, 50),
        p95Ms: percentile(times, 95)
    };
}

async function run(): Promise<void> {
    process.env.NODE_ENV = "test";
    const iterations = Number.parseInt(process.env.SMART_CONTEXT_LARGE_REPO_ITERATIONS ?? "20", 10);
    const docCount = Number.parseInt(process.env.SMART_CONTEXT_LARGE_REPO_DOCS ?? "1500", 10);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "large-repo-doc-search-"));
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });

    for (let i = 0; i < docCount; i += 1) {
        const content = [
            `# Doc ${i}`,
            "This document covers installation guidance.",
            `Unique token ${i}`,
            i % 25 === 0 ? "install steps included here." : ""
        ].join("\n");
        fs.writeFileSync(path.join(docsDir, `doc_${i}.md`), content, "utf8");
    }

    const server = new SmartContextServer(root);
    const stats = await measure(server, iterations);

    const reportLines = [
        "# Large Repo Document Search Benchmark",
        "",
        `Documents: ${docCount}`,
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
    const reportPath = path.join(reportDir, `large-repo-doc-search-${Date.now()}.md`);
    fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

    console.log(reportLines.join("\n"));
    console.log(`\nReport saved to ${reportPath}`);

    await server.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(0);
}

run().catch((error) => {
    console.error("Benchmark failed:", error);
    process.exit(1);
});
