import { performance } from "perf_hooks";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

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

function runValidation(): void {
  const nodePath = process.execPath;
  execFileSync(nodePath, ["--import", "tsx", "scripts/validate-parity.ts"], {
    stdio: "ignore"
  });
}

function run(): void {
  const iterations = Number.parseInt(process.env.PARITY_BENCH_ITERATIONS ?? "5", 10);
  const times: number[] = [];

  runValidation();
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    runValidation();
    times.push(performance.now() - start);
  }

  const avgMs = times.reduce((sum, value) => sum + value, 0) / iterations;
  const stats: BenchStats = {
    avgMs,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95)
  };

  const reportLines = [
    "# Parity Validation Benchmark",
    "",
    `Iterations: ${iterations}`,
    "",
    "| Metric | Avg (ms) | P50 (ms) | P95 (ms) |",
    "| --- | --- | --- | --- |",
    `| validate:parity | ${stats.avgMs.toFixed(4)} | ${stats.p50Ms.toFixed(4)} | ${stats.p95Ms.toFixed(4)} |`
  ];

  const reportDir = path.join(process.cwd(), "benchmarks", "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `parity-validation-${Date.now()}.md`);
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  console.log(reportLines.join("\n"));
  console.log(`\nReport saved to ${reportPath}`);
}

run();
