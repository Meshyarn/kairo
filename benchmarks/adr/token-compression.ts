import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { InternalToolRegistry } from "../src/orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../src/orchestration/OrchestrationContext.js";
import { ExplorePillar } from "../src/orchestration/pillars/explore/ExplorePillar.js";
import { UnderstandPillar } from "../src/orchestration/pillars/UnderstandPillar.js";

type BenchStats = {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function measure(label: string, iterations: number, run: () => Promise<void>): Promise<BenchStats> {
  const times: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    await run();
  }
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  const total = times.reduce((sum, value) => sum + value, 0);
  const stats = {
    avgMs: total / iterations,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95)
  };
  console.log(`${label}: avg=${stats.avgMs.toFixed(4)}ms p50=${stats.p50Ms.toFixed(4)}ms p95=${stats.p95Ms.toFixed(4)}ms`);
  return stats;
}

async function run(): Promise<void> {
  process.env.KAIRO_SKIP_PARITY_CHECK = "true";
  const iterations = Number.parseInt(process.env.KAIRO_TOKEN_BENCH_ITERATIONS ?? "200", 10);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-compression-"));
  const srcDir = path.join(root, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  const filePath = path.join(srcDir, "main.ts");
  const fileContent = [
    "export function alpha() {",
    "  return 'alpha';",
    "}",
    "",
    "export function beta() {",
    "  return 'beta';",
    "}"
  ].join("\n");
  fs.writeFileSync(filePath, fileContent, "utf8");

  const registry = new InternalToolRegistry();
  registry.register("project_profile", async () => ({ fileCount: 120 }));
  registry.register("project_search", async () => ({
    results: [
      { path: filePath, context: fileContent, score: 0.9, line: 1, type: "file" }
    ]
  }));
  registry.register("document_search", async () => ({ results: [] }));
  registry.register("code_read", async (args: any) => {
    if (args?.view === "skeleton") {
      return "export function alpha() { /* ... */ }\nexport function beta() { /* ... */ }";
    }
    return fileContent;
  });
  registry.register("file_profile", async () => ({
    metadata: {
      filePath,
      relativePath: path.relative(root, filePath),
      lineCount: fileContent.split(/\r?\n/).length,
      language: "typescript"
    },
    structure: {
      skeleton: "export function alpha() { /* ... */ }\nexport function beta() { /* ... */ }",
      symbols: [
        { name: "alpha", type: "function", range: { startLine: 1, endLine: 1, startByte: 0, endByte: 10 } },
        { name: "beta", type: "function", range: { startLine: 5, endLine: 5, startByte: 0, endByte: 10 } }
      ]
    }
  }));

  const explore = new ExplorePillar(registry);
  const understand = new UnderstandPillar(registry);

  const exploreIntent = (limits: Record<string, unknown>) => ({
    category: "explore",
    action: "execute",
    targets: [],
    originalIntent: "",
    constraints: { query: "alpha", include: { docs: false, code: true }, limits }
  });
  const understandIntent = (limits: Record<string, unknown>) => ({
    category: "understand",
    action: "execute",
    targets: [],
    originalIntent: "",
    constraints: { goal: "alpha", limits }
  });

  const exploreBaseline = await measure("Explore baseline", iterations, async () => {
    await explore.execute(exploreIntent({}) as any, new OrchestrationContext());
  });
  const exploreLimited = await measure("Explore token-limited", iterations, async () => {
    await explore.execute(exploreIntent({ maxTokens: 8 }) as any, new OrchestrationContext());
  });
  const understandBaseline = await measure("Understand baseline", iterations, async () => {
    await understand.execute(understandIntent({}) as any, new OrchestrationContext());
  });
  const understandLimited = await measure("Understand token-limited", iterations, async () => {
    await understand.execute(understandIntent({ maxTokens: 8 }) as any, new OrchestrationContext());
  });

  const reportLines = [
    "# Token Compression Overhead Benchmark",
    "",
    `Iterations: ${iterations}`,
    "",
    "| Scenario | Avg (ms) | P50 (ms) | P95 (ms) |",
    "| --- | --- | --- | --- |",
    `| Explore baseline | ${exploreBaseline.avgMs.toFixed(4)} | ${exploreBaseline.p50Ms.toFixed(4)} | ${exploreBaseline.p95Ms.toFixed(4)} |`,
    `| Explore token-limited | ${exploreLimited.avgMs.toFixed(4)} | ${exploreLimited.p50Ms.toFixed(4)} | ${exploreLimited.p95Ms.toFixed(4)} |`,
    `| Understand baseline | ${understandBaseline.avgMs.toFixed(4)} | ${understandBaseline.p50Ms.toFixed(4)} | ${understandBaseline.p95Ms.toFixed(4)} |`,
    `| Understand token-limited | ${understandLimited.avgMs.toFixed(4)} | ${understandLimited.p50Ms.toFixed(4)} | ${understandLimited.p95Ms.toFixed(4)} |`
  ];

  const reportDir = path.join(process.cwd(), "benchmarks", "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `token-compression-${Date.now()}.md`);
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  console.log(reportLines.join("\n"));
  console.log(`\nReport saved to ${reportPath}`);

  fs.rmSync(root, { recursive: true, force: true });
}

run().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
