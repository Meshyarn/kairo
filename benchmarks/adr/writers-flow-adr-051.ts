import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FlowArtifactManager } from "../src/orchestration/flow-artifact-manager.js";
import { scoreVibeAlignment } from "../src/generation/vibe-alignment-scorer.js";
import type { StylePack } from "../src/types/flow-artifacts.js";

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

function summarize(times: number[]): BenchStats {
  const total = times.reduce((sum, value) => sum + value, 0);
  return {
    avgMs: total / Math.max(1, times.length),
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95)
  };
}

function runTimed(iterations: number, fn: () => void): BenchStats {
  const times: number[] = [];
  for (let i = 0; i < Math.min(5, iterations); i += 1) {
    fn();
  }
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }
  return summarize(times);
}

function buildStylePack(): StylePack {
  return {
    id: "style_bench",
    scope: "**/*",
    createdAt: Date.now(),
    profile: {
      codeStyle: {
        indent: "spaces",
        indentSize: 2,
        quotes: "single",
        semicolons: true,
        lineEndings: "lf"
      },
      patterns: {
        imports: [{ module: "react", style: "named", count: 2 }],
        naming: [{ type: "function", convention: "camelCase", confidence: 0.8 }],
        fileOrg: { fileNamePattern: "*.ts", directoryPattern: "." }
      },
      confidence: "medium"
    }
  };
}

function buildSampleContent(): string {
  const lines = [];
  lines.push("import { useState } from 'react';");
  lines.push("");
  for (let i = 0; i < 200; i += 1) {
    lines.push(`export const value${i} = ${i};`);
  }
  return lines.join("\n");
}

function writeReport(lines: string[]): string {
  const reportDir = path.join(process.cwd(), "benchmarks", "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `writers-flow-adr-051-${Date.now()}.md`);
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}

async function run(): Promise<void> {
  const iterations = Number.parseInt(process.env.KAIRO_WRITERS_FLOW_BENCH_ITERATIONS ?? "250", 10);
  const stylePack = buildStylePack();
  const content = buildSampleContent();
  const filePath = "src/bench/sample.ts";

  const manager = new FlowArtifactManager();
  const sessionId = manager.resolveSessionId("new", "bench-session") as string;
  for (let i = 0; i < 25; i += 1) {
    manager.store({
      id: `style_${i}`,
      type: "style",
      createdAt: Date.now() + i,
      pack: stylePack,
      sessionId
    } as any);
  }

  const lookupStats = runTimed(iterations, () => {
    manager.getLatestStylePack(sessionId);
  });

  const vibeStats = runTimed(iterations, () => {
    scoreVibeAlignment({
      filePath,
      content,
      stylePack,
      strictness: "balanced"
    });
  });

  const vibeNoStyleStats = runTimed(iterations, () => {
    scoreVibeAlignment({
      filePath,
      content,
      strictness: "balanced"
    });
  });

  const overheadMs = vibeStats.avgMs - vibeNoStyleStats.avgMs;
  const overheadPct = vibeNoStyleStats.avgMs === 0 ? 0 : (overheadMs / vibeNoStyleStats.avgMs) * 100;

  const reportLines = [
    "# ADR-051 Writer Flow Benchmark",
    "",
    `Iterations: ${iterations}`,
    "",
    "## Session StylePack Lookup",
    "",
    "| Metric | Avg (ms) | P50 (ms) | P95 (ms) |",
    "| --- | --- | --- | --- |",
    `| getLatestStylePack | ${lookupStats.avgMs.toFixed(4)} | ${lookupStats.p50Ms.toFixed(4)} | ${lookupStats.p95Ms.toFixed(4)} |`,
    "",
    "## Vibe Alignment Scoring",
    "",
    "| Scenario | Avg (ms) | P50 (ms) | P95 (ms) |",
    "| --- | --- | --- | --- |",
    `| With StylePack | ${vibeStats.avgMs.toFixed(4)} | ${vibeStats.p50Ms.toFixed(4)} | ${vibeStats.p95Ms.toFixed(4)} |`,
    `| No StylePack | ${vibeNoStyleStats.avgMs.toFixed(4)} | ${vibeNoStyleStats.p50Ms.toFixed(4)} | ${vibeNoStyleStats.p95Ms.toFixed(4)} |`,
    "",
    `Overhead: ${overheadMs.toFixed(4)}ms (${overheadPct.toFixed(2)}%)`
  ];

  const reportPath = writeReport(reportLines);
  console.log(reportLines.join("\n"));
  console.log(`\nReport saved to ${reportPath}`);
}

run().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
