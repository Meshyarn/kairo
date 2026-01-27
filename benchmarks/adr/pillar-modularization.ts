import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";

import { InternalToolRegistry } from "../src/orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../src/orchestration/OrchestrationContext.js";
import { ChangePillar } from "../src/orchestration/pillars/change/ChangePillar.js";
import { ExplorePillar } from "../src/orchestration/pillars/explore/ExplorePillar.js";
import { WritePillar } from "../src/orchestration/pillars/WritePillar.js";
import type { ParsedIntent } from "../src/orchestration/IntentRouter.js";

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function measure(name: string, fn: () => Promise<void>, iterations: number): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < 5; i += 1) {
    await fn();
  }

  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const totalMs = times.reduce((acc, value) => acc + value, 0);
  return {
    name,
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95)
  };
}

function buildRegistry(): InternalToolRegistry {
  const registry = new InternalToolRegistry();

  registry.register("document_search", async () => ({
    results: [{ filePath: "docs/ARCHITECTURE.md", preview: "doc", scores: { final: 0.8 } }]
  }) as any);
  registry.register("project_search", async () => ({
    results: [{ path: "src/engine/Search.ts", context: "class SearchEngine", score: 0.9, type: "file", line: 1 }]
  }) as any);
  registry.register("edit_transaction", async () => ({
    success: true,
    diff: "diff",
    operation: { id: "op-bench" }
  }) as any);
  registry.register("file_write", async () => ({ success: true }) as any);

  return registry;
}

function buildChangeIntent(): ParsedIntent {
  return {
    category: "change",
    action: "execute",
    targets: ["src/engine/Search.ts"],
    originalIntent: "Update Search",
    constraints: {
      targetPath: "src/engine/Search.ts",
      edits: [{ targetString: "short", replacementString: "longer" }],
      dryRun: true,
      includeImpact: false,
      integrity: false
    },
    confidence: 1
  };
}

function buildExploreIntent(): ParsedIntent {
  return {
    category: "explore",
    action: "execute",
    targets: [],
    originalIntent: "Explore Search",
    constraints: {
      query: "SearchEngine",
      view: "preview",
      include: { docs: true, code: true },
      limits: { maxResults: 4 }
    },
    confidence: 1
  };
}

function buildWriteIntent(): ParsedIntent {
  return {
    category: "write",
    action: "execute",
    targets: ["src/bench/generated.ts"],
    originalIntent: "Write benchmark file",
    constraints: {
      targetPath: "src/bench/generated.ts",
      content: "export const bench = 1;",
      safeWrite: false
    },
    confidence: 1
  };
}

async function run(): Promise<void> {
  const iterations = Number.parseInt(process.env.SMART_CONTEXT_PILLAR_BENCH_ITERATIONS ?? "50", 10);

  const registry = buildRegistry();
  const change = new ChangePillar(registry);
  const explore = new ExplorePillar(registry);
  const write = new WritePillar(registry);

  const changeIntent = buildChangeIntent();
  const exploreIntent = buildExploreIntent();
  const writeIntent = buildWriteIntent();

  const results: BenchmarkResult[] = [];
  results.push(await measure("ChangePillar.execute", async () => {
    await change.execute(changeIntent, new OrchestrationContext());
  }, iterations));
  results.push(await measure("ExplorePillar.execute", async () => {
    await explore.execute(exploreIntent, new OrchestrationContext());
  }, iterations));
  results.push(await measure("WritePillar.execute", async () => {
    await write.execute(writeIntent, new OrchestrationContext());
  }, iterations));

  const reportLines = [
    "# Pillar Modularization Benchmark",
    "",
    `Iterations: ${iterations}`,
    "",
    "| Pillar | Avg (ms) | P50 (ms) | P95 (ms) |",
    "| --- | --- | --- | --- |",
    ...results.map(result =>
      `| ${result.name} | ${result.avgMs.toFixed(2)} | ${result.p50Ms.toFixed(2)} | ${result.p95Ms.toFixed(2)} |`
    )
  ];

  const reportDir = path.join(process.cwd(), "benchmarks", "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `pillar-modularization-${Date.now()}.md`);
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  console.log(reportLines.join("\n"));
  console.log(`\nReport saved to ${reportPath}`);
}

run().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
