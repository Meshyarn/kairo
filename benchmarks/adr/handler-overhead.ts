import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SmartContextServer } from "../src/index.js";
import { FeatureFlags } from "../src/config/FeatureFlags.js";
import { buildDegradedReasons } from "../src/orchestration/DegradedReasonMapper.js";

interface BenchStats {
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

async function measure(
  server: SmartContextServer,
  iterations: number,
  toolName: string,
  args: any
): Promise<BenchStats> {
  const times: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    await (server as any).handleCallTool(toolName, args);
  }
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await (server as any).handleCallTool(toolName, args);
    const end = performance.now();
    times.push(end - start);
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
  const iterations = Number.parseInt(process.env.SMART_CONTEXT_HANDLER_BENCH_ITERATIONS ?? "200", 10);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handler-overhead-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const filePath = path.join(root, "src", "sample.ts");
  fs.writeFileSync(filePath, "export const value = 1;\n", "utf8");

  const server = new SmartContextServer(root);
  const relPath = path.relative(root, filePath);
  const args = { filePath: relPath };

  FeatureFlags.set(FeatureFlags.MODULAR_HANDLERS_ENABLED, false, "off");
  const legacy = await measure(server, iterations, "file_stat", args);

  FeatureFlags.set(FeatureFlags.MODULAR_HANDLERS_ENABLED, true, "on");
  const modular = await measure(server, iterations, "file_stat", args);

  const overheadMs = modular.avgMs - legacy.avgMs;
  const overheadPct = legacy.avgMs === 0 ? 0 : (overheadMs / legacy.avgMs) * 100;

  const mapperSamples = ["missing_query_pack", "missing_wasm_grammar", "contract_manifest_missing"];
  const mapperTimes: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    buildDegradedReasons(mapperSamples, { languageId: "typescript" });
    mapperTimes.push(performance.now() - start);
  }
  const mapperStats = {
    avgMs: mapperTimes.reduce((sum, value) => sum + value, 0) / iterations,
    p50Ms: percentile(mapperTimes, 50),
    p95Ms: percentile(mapperTimes, 95)
  };

  const reportLines = [
    "# Handler Dispatch Overhead Benchmark",
    "",
    `Iterations: ${iterations}`,
    "",
    "| Mode | Avg (ms) | P50 (ms) | P95 (ms) |",
    "| --- | --- | --- | --- |",
    `| Legacy (direct registry) | ${legacy.avgMs.toFixed(4)} | ${legacy.p50Ms.toFixed(4)} | ${legacy.p95Ms.toFixed(4)} |`,
    `| Modular (handler registry) | ${modular.avgMs.toFixed(4)} | ${modular.p50Ms.toFixed(4)} | ${modular.p95Ms.toFixed(4)} |`,
    `| DegradedReasonMapper | ${mapperStats.avgMs.toFixed(4)} | ${mapperStats.p50Ms.toFixed(4)} | ${mapperStats.p95Ms.toFixed(4)} |`,
    "",
    `Overhead: ${overheadMs.toFixed(4)}ms (${overheadPct.toFixed(2)}%)`
  ];

  const reportDir = path.join(process.cwd(), "benchmarks", "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `handler-overhead-${Date.now()}.md`);
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
