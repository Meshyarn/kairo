import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import { InternalToolRegistry } from "../src/orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../src/orchestration/OrchestrationContext.js";
import { ChangePillar } from "../src/orchestration/pillars/change/ChangePillar.js";

interface BenchStats {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  selectBestRate: number;
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
};

const buildIntent = (mcts: { maxDepth: number; maxRollouts: number; exploration: number; seed?: number }) => ({
  category: "change",
  action: "modify",
  targets: ["src/demo.ts"],
  originalIntent: "update demo",
  constraints: {
    dryRun: true,
    includeImpact: false,
    edits: [{ targetString: "BASE", replacementString: "BASE_NEW" }],
    strategySearch: {
      mode: "force",
      stage: "r3",
      maxCandidates: 1,
      mcts,
      candidates: [
        {
          id: "root",
          edits: [{ targetString: "ROOT", replacementString: "ROOT1" }],
          children: [
            { id: "leaf_bad", edits: [{ targetString: "BAD", replacementString: "B1" }] },
            { id: "leaf_ok", edits: [{ targetString: "OK", replacementString: "O1" }] },
            { id: "leaf_best", edits: [{ targetString: "BEST", replacementString: "G1" }] }
          ]
        }
      ]
    }
  },
  confidence: 1
});

async function measure(
  pillar: ChangePillar,
  iterations: number,
  config: { label: string; maxDepth: number; maxRollouts: number; exploration: number }
): Promise<BenchStats> {
  const times: number[] = [];
  let bestCount = 0;

  for (let i = 0; i < 5; i += 1) {
    await pillar.execute(buildIntent({ ...config, seed: 1000 + i }) as any, new OrchestrationContext());
  }

  for (let i = 0; i < iterations; i += 1) {
    const seed = 2000 + i;
    const start = performance.now();
    const result = await pillar.execute(
      buildIntent({ ...config, seed }) as any,
      new OrchestrationContext()
    );
    const end = performance.now();
    times.push(end - start);
    if (result?.strategySearch?.selectedCandidateId === "leaf_best") {
      bestCount += 1;
    }
  }

  const total = times.reduce((sum, value) => sum + value, 0);
  return {
    avgMs: total / iterations,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    selectBestRate: iterations > 0 ? bestCount / iterations : 0
  };
}

async function run(): Promise<void> {
  process.env.NODE_ENV = "test";
  process.env.KAIRO_SKIP_PARITY_CHECK = "true";

  const registry = new InternalToolRegistry();
  registry.register("edit_transaction", async (args: any) => {
    const target = args?.edits?.[0]?.targetString ?? "";
    if (target === "BEST") {
      return { success: true, diff: "diffBest", structuredDiff: [{ added: 1, removed: 0 }] } as any;
    }
    if (target === "OK") {
      return { success: true, diff: "diffOk", structuredDiff: [{ added: 4, removed: 0 }] } as any;
    }
    if (target === "BAD") {
      return { success: true, diff: "diffBad", structuredDiff: [{ added: 12, removed: 0 }] } as any;
    }
    return { success: true, diff: "diffRoot", structuredDiff: [{ added: 6, removed: 0 }] } as any;
  });
  registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] } as any));
  registry.register("hotspot_detect", async () => ([] as any));

  const pillar = new ChangePillar(registry);
  const iterations = Number.parseInt(process.env.KAIRO_STRATEGY_SEARCH_C_BENCH_ITERATIONS ?? "200", 10);
  const configs = [
    { label: "depth2_roll4", maxDepth: 2, maxRollouts: 4, exploration: 1.4 },
    { label: "depth2_roll8", maxDepth: 2, maxRollouts: 8, exploration: 1.4 },
    { label: "depth3_roll12", maxDepth: 3, maxRollouts: 12, exploration: 1.4 }
  ];

  const results = [];
  for (const config of configs) {
    const stats = await measure(pillar, iterations, config);
    results.push({ config, stats });
  }

  const reportLines = [
    "# Strategy Search Phase C (MCTS) Benchmark",
    "",
    `Iterations: ${iterations}`,
    "",
    "| Config | Avg (ms) | P50 (ms) | P95 (ms) | Best Pick Rate |",
    "| --- | --- | --- | --- | --- |"
  ];

  for (const entry of results) {
    reportLines.push(
      `| ${entry.config.label} | ${entry.stats.avgMs.toFixed(4)} | ${entry.stats.p50Ms.toFixed(4)} | ${entry.stats.p95Ms.toFixed(4)} | ${(entry.stats.selectBestRate * 100).toFixed(1)}% |`
    );
  }

  const reportDir = path.join(process.cwd(), "benchmarks", "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `strategy-search-phase-c-${Date.now()}.md`);
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  console.log(reportLines.join("\n"));
  console.log(`\nReport saved to ${reportPath}`);
}

run().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
