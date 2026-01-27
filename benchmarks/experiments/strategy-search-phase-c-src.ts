import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import { InternalToolRegistry } from "../src/orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../src/orchestration/OrchestrationContext.js";
import { ChangePillar } from "../src/orchestration/pillars/change/ChangePillar.js";
import { NodeFileSystem } from "../src/platform/FileSystem.js";
import { EditorEngine } from "../src/engine/Editor.js";
import { HistoryEngine } from "../src/engine/History.js";
import { EditCoordinator } from "../src/engine/EditCoordinator.js";

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

const TARGET_FILE = "src/orchestration/trace/TraceBuilder.ts";
const TARGET_EVENT_CAP = "const DEFAULT_EVENT_CAP = 50;";
const TARGET_MAX_BYTES = "const DEFAULT_MAX_BYTES = 16 * 1024;";

const buildIntent = (mcts: { maxDepth: number; maxRollouts: number; exploration: number; seed?: number }) => ({
  category: "change",
  action: "modify",
  targets: [TARGET_FILE],
  originalIntent: "tune trace builder defaults",
  constraints: {
    dryRun: true,
    includeImpact: false,
    edits: [{ targetString: TARGET_EVENT_CAP, replacementString: "const DEFAULT_EVENT_CAP = 55;" }],
    strategySearch: {
      mode: "force",
      stage: "r3",
      maxCandidates: 1,
      mcts,
      candidates: [
        {
          id: "root",
          targetFiles: [TARGET_FILE],
          edits: [
            { targetString: TARGET_EVENT_CAP, replacementString: "const DEFAULT_EVENT_CAP = 55;" },
            { targetString: TARGET_MAX_BYTES, replacementString: "const DEFAULT_MAX_BYTES = 12 * 1024;" }
          ],
          children: [
            {
              id: "leaf_small",
              targetFiles: [TARGET_FILE],
              edits: [{ targetString: TARGET_EVENT_CAP, replacementString: "const DEFAULT_EVENT_CAP = 55;" }]
            },
            {
              id: "leaf_medium",
              targetFiles: [TARGET_FILE],
              edits: [{
                targetString: TARGET_EVENT_CAP,
                replacementString: "const DEFAULT_EVENT_CAP = 55;\n// NOTE: increase cap for trace-heavy flows"
              }]
            },
            {
              id: "leaf_large",
              targetFiles: [TARGET_FILE],
              edits: [{
                targetString: TARGET_EVENT_CAP,
                replacementString: "const DEFAULT_EVENT_CAP = 55;\n// NOTE: increase cap for trace-heavy flows\n// NOTE: keep within memory budget"
              }]
            }
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
    if (result?.strategySearch?.selectedCandidateId === "leaf_small") {
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

  const fileSystem = new NodeFileSystem(process.cwd());
  const editorEngine = new EditorEngine(process.cwd(), fileSystem);
  const historyEngine = new HistoryEngine(process.cwd(), fileSystem);
  const coordinator = new EditCoordinator(editorEngine, historyEngine, process.cwd());

  const registry = new InternalToolRegistry();
  registry.register("edit_transaction", async (args: any) => {
    const filePath = args?.filePath ?? args?.path ?? args?.target;
    if (!filePath) {
      return { success: false, message: "filePath is required for edit_transaction." };
    }
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    const edits = Array.isArray(args?.edits) ? args.edits : [];
    const dryRun = Boolean(args?.dryRun);
    const diffMode = args?.options?.diffMode;
    const options = diffMode ? { diffMode } : undefined;
    return coordinator.applyEdits(absPath, edits, dryRun, options);
  });
  registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] } as any));
  registry.register("hotspot_detect", async () => ([] as any));

  const pillar = new ChangePillar(registry);
  const iterations = Number.parseInt(process.env.KAIRO_STRATEGY_SEARCH_C_SRC_ITERATIONS ?? "100", 10);
  const configs = [
    { label: "depth2_roll2", maxDepth: 2, maxRollouts: 2, exploration: 1.4 },
    { label: "depth2_roll3", maxDepth: 2, maxRollouts: 3, exploration: 1.4 },
    { label: "depth2_roll5", maxDepth: 2, maxRollouts: 5, exploration: 1.4 }
  ];

  const results = [];
  for (const config of configs) {
    const stats = await measure(pillar, iterations, config);
    results.push({ config, stats });
  }

  const reportLines = [
    "# Strategy Search Phase C (src scenario)",
    "",
    `File: ${TARGET_FILE}`,
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
  const reportPath = path.join(reportDir, `strategy-search-phase-c-src-${Date.now()}.md`);
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  console.log(reportLines.join("\n"));
  console.log(`\nReport saved to ${reportPath}`);
}

run().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
