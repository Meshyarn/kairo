import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import { InternalToolRegistry } from "../src/orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../src/orchestration/OrchestrationContext.js";
import { ChangePillar } from "../src/orchestration/pillars/change/ChangePillar.js";
import { SymbolicGuardEngine } from "../src/engine/validators/symbolic-guard-engine.js";

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

const buildIntent = (includeImpact: boolean) => ({
  category: "change",
  action: "modify",
  targets: ["src/demo.ts"],
  originalIntent: "update demo",
  constraints: {
    dryRun: true,
    includeImpact,
    edits: [{ targetString: "BASE", replacementString: "BASE_NEW" }],
    strategySearch: {
      mode: "force",
      stage: "r1",
      maxImpactMs: 200,
      candidates: [
        { id: "risky", edits: [{ targetString: "A", replacementString: "A1" }] },
        { id: "safe", edits: [{ targetString: "B", replacementString: "B1" }] }
      ]
    }
  },
  confidence: 1
});

async function measure(
  pillar: ChangePillar,
  iterations: number,
  includeImpact: boolean
): Promise<{ stats: BenchStats; selected?: string }> {
  const times: number[] = [];
  let selected: string | undefined;
  for (let i = 0; i < 5; i += 1) {
    await pillar.execute(buildIntent(includeImpact) as any, new OrchestrationContext());
  }
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    const result = await pillar.execute(buildIntent(includeImpact) as any, new OrchestrationContext());
    const end = performance.now();
    times.push(end - start);
    if (!selected) {
      selected = result?.strategySearch?.selectedCandidateId;
    }
  }
  const total = times.reduce((sum, value) => sum + value, 0);
  return {
    selected,
    stats: {
      avgMs: total / iterations,
      p50Ms: percentile(times, 50),
      p95Ms: percentile(times, 95)
    }
  };
}

async function run(): Promise<void> {
  process.env.NODE_ENV = "test";
  process.env.KAIRO_SKIP_PARITY_CHECK = "true";

  const originalEnabled = process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED;
  const originalMode = process.env.KAIRO_SYMBOLIC_GUARDS_MODE;
  process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED = "true";
  process.env.KAIRO_SYMBOLIC_GUARDS_MODE = "warn";

  const registry = new InternalToolRegistry();
  registry.register("edit_transaction", async (args: any) => {
    const target = args?.edits?.[0]?.targetString ?? "";
    const content = target === "A" ? "BREAK_GUARD" : "SAFE_GUARD";
    return {
      success: true,
      diff: "diff",
      structuredDiff: [{ added: 5, removed: 0 }],
      newContent: content
    } as any;
  });
  registry.register("impact_analyze", async () => ({ riskLevel: "low" } as any));
  registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] } as any));
  registry.register("hotspot_detect", async () => ([] as any));

  const guardSpy = SymbolicGuardEngine.prototype.evaluate;
  SymbolicGuardEngine.prototype.evaluate = async ({ content }: any) => {
    const isRisky = String(content).includes("BREAK_GUARD");
    return {
      enabled: true,
      mode: "warn",
      diagnostics: isRisky
        ? [{ code: "index_bounds", severity: "high", message: "guard high" }]
        : [],
      degradedReasons: [],
      stats: { durationMs: 1, queryUsed: true, solverUsed: false }
    };
  };

  const pillar = new ChangePillar(registry) as any;
  pillar.buildCrossLangImpact = async (_targetPath: string, _context: any, options?: any) => {
    if (String(options?.afterContent).includes("BREAK_GUARD")) {
      return {
        packageName: "demo",
        consumerFiles: ["src/consumer.ts"],
        changedExports: ["foo"],
        breakingExports: ["foo"],
        degraded: false
      };
    }
    return {
      packageName: "demo",
      consumerFiles: [],
      changedExports: [],
      degraded: false
    };
  };

  const iterations = Number.parseInt(process.env.KAIRO_STRATEGY_SEARCH_BENCH_ITERATIONS ?? "200", 10);
  const withoutSignals = await measure(pillar, iterations, false);
  const withSignals = await measure(pillar, iterations, true);

  SymbolicGuardEngine.prototype.evaluate = guardSpy;
  if (originalEnabled === undefined) {
    delete process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED;
  } else {
    process.env.KAIRO_SYMBOLIC_GUARDS_ENABLED = originalEnabled;
  }
  if (originalMode === undefined) {
    delete process.env.KAIRO_SYMBOLIC_GUARDS_MODE;
  } else {
    process.env.KAIRO_SYMBOLIC_GUARDS_MODE = originalMode;
  }

  const reportLines = [
    "# Strategy Search Phase B Benchmark",
    "",
    `Iterations: ${iterations}`,
    "",
    "| Mode | Avg (ms) | P50 (ms) | P95 (ms) | Selected |",
    "| --- | --- | --- | --- | --- |",
    `| No contract/guards scoring | ${withoutSignals.stats.avgMs.toFixed(4)} | ${withoutSignals.stats.p50Ms.toFixed(4)} | ${withoutSignals.stats.p95Ms.toFixed(4)} | ${withoutSignals.selected ?? "unknown"} |`,
    `| With contract/guards scoring | ${withSignals.stats.avgMs.toFixed(4)} | ${withSignals.stats.p50Ms.toFixed(4)} | ${withSignals.stats.p95Ms.toFixed(4)} | ${withSignals.selected ?? "unknown"} |`
  ];

  const reportDir = path.join(process.cwd(), "benchmarks", "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `strategy-search-phase-b-${Date.now()}.md`);
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  console.log(reportLines.join("\n"));
  console.log(`\nReport saved to ${reportPath}`);
}

run().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
