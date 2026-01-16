import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.KAIRO_METRICS_MODE = process.env.KAIRO_METRICS_MODE ?? "basic";

const DEFAULT_THRESHOLDS = {
  S: { explore: 1500, understand: 2500, change: 3500, write: 3500 },
  M: { explore: 3000, understand: 5000, change: 7000, write: 8000 },
  L: { explore: 6000, understand: 9000, change: 12000, write: 14000 }
};

const HISTOGRAM_NAMES = {
  explore: "explore.total_ms",
  understand: "understand.total_ms",
  change: "change.total_ms",
  write: "write.total_ms"
};

async function main() {
  const { metrics } = await import("../dist/utils/MetricsCollector.js");
  const { SmartContextServer } = await import("../dist/index.js");

  metrics.reset();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-cost-slo-"));
  const srcDir = path.join(root, "src");
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  fs.writeFileSync(path.join(srcDir, "main.ts"), "export function main() { return 'hello'; }\n", "utf-8");
  fs.writeFileSync(path.join(srcDir, "helper.ts"), "export const helper = () => 'hello';\n", "utf-8");
  fs.writeFileSync(path.join(docsDir, "readme.md"), "# Hello\nLean preset docs.\n", "utf-8");
  fs.writeFileSync(path.join(docsDir, "guide.md"), "# Guide\nMore docs.\n", "utf-8");

  const server = new SmartContextServer(root);

  try {
    await runScenario(server);

    const snapshot = metrics.snapshot();
    const fileCount = countFiles(root);
    const scaleTier = resolveScaleTier(fileCount);
    const thresholds = DEFAULT_THRESHOLDS[scaleTier];

    const results = Object.entries(HISTOGRAM_NAMES).map(([key, name]) => {
      const hist = snapshot.histograms[name];
      const p95 = hist?.p95 ?? hist?.max ?? 0;
      const threshold = thresholds[key];
      const count = hist?.count ?? 0;
      const status = count > 0 && Number.isFinite(p95) && p95 <= threshold ? "PASS" : "FAIL";
      return { metric: name, p95, threshold, count, status };
    });

    const report = {
      scaleTier,
      fileCount,
      thresholds,
      results
    };

    const reportDir = path.join("benchmarks", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `adr-078-cost-slo-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`Wrote ADR-078 cost SLO report to ${reportPath}`);

    const failures = results.filter(result => result.status !== "PASS");
    if (failures.length > 0) {
      console.error("Cost SLO gate failed:");
      for (const failure of failures) {
        console.error(`- ${failure.metric}: p95=${failure.p95}ms (threshold ${failure.threshold}ms)`);
      }
      process.exitCode = 1;
    }
  } finally {
    await server.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function runScenario(server) {
  for (let i = 0; i < 3; i += 1) {
    await runTool(server, "explore", {
      query: "hello",
      include: { docs: true, code: true },
      profile: "lean"
    });
    await runTool(server, "understand", {
      goal: "src/main.ts",
      scope: "file",
      profile: "lean"
    });
    await runTool(server, "change", {
      intent: "Rename main function to greet",
      target: "src/main.ts",
      profile: "lean",
      safety: "plan"
    }, { expectSuccess: false });
    await runTool(server, "write", {
      intent: "Create a new helper file",
      targetPath: "src/new-helper.ts",
      content: "export const helper2 = () => 'ok';\n",
      profile: "lean",
      dryRun: true
    });
  }
}

async function runTool(server, toolName, args, options = { expectSuccess: true }) {
  const response = await server.handleCallTool(toolName, args);
  if (response?.isError) {
    if (options.expectSuccess) {
      const errorText = response.content?.[0]?.text ?? response.error ?? "Unknown error";
      throw new Error(`Tool ${toolName} failed: ${errorText}`);
    }
    console.warn(`Tool ${toolName} reported error (continuing):`, response.error ?? response.content?.[0]?.text);
  }
  return response;
}

function resolveScaleTier(fileCount) {
  if (!Number.isFinite(fileCount)) return "S";
  const sMax = parseNumberEnv(process.env.KAIRO_SCALE_TIER_S_MAX_FILES, 5000);
  const mMax = parseNumberEnv(process.env.KAIRO_SCALE_TIER_M_MAX_FILES, 50000);
  if (fileCount < sMax) return "S";
  if (fileCount < mMax) return "M";
  return "L";
}

function parseNumberEnv(raw, fallback) {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function countFiles(root) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        total += 1;
      }
    }
  }
  return total;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
