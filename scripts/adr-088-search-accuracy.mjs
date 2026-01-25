import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.KAIRO_MODE = "mcp";
process.env.KAIRO_PUBLIC_SURFACE = process.env.KAIRO_PUBLIC_SURFACE ?? "compact";
process.env.KAIRO_WARMUP_ENABLED = process.env.KAIRO_WARMUP_ENABLED ?? "false";
process.env.KAIRO_ALLOW_CWD_ROOT = process.env.KAIRO_ALLOW_CWD_ROOT ?? "true";
process.env.KAIRO_STORAGE_MODE = process.env.KAIRO_STORAGE_MODE ?? "memory";
process.env.KAIRO_TEST_USE_NATIVE_CORE = process.env.KAIRO_TEST_USE_NATIVE_CORE ?? "true";
process.env.KAIRO_RUST_CORE_ENABLED = process.env.KAIRO_RUST_CORE_ENABLED ?? "true";

const DEFAULTS = {
  fileCount: 400,
  queryCount: 80,
  maxResults: 5
};

const parseNumberEnv = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizePath = (value) => value.replace(/\\/g, "/").replace(/^\.\//, "");

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
};

const writeFile = (root, relativePath, content) => {
  const absPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
};

async function runTool(server, toolName, args) {
  const response = await server.handleCallTool(toolName, args);
  if (!response || response.isError) {
    const message = response?.content?.[0]?.text ?? "Tool error";
    throw new Error(message);
  }
  return JSON.parse(response.content?.[0]?.text ?? "{}");
}

async function run() {
  const { SmartContextServer } = await import("../dist/index.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr088-search-"));

  const fileCount = Math.max(1, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_FILE_COUNT, DEFAULTS.fileCount)));
  const queryCount = Math.max(
    1,
    Math.min(fileCount, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_QUERY_COUNT, DEFAULTS.queryCount)))
  );
  const maxResults = Math.max(1, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_MAX_RESULTS, DEFAULTS.maxResults)));

  const expectedByQuery = new Map();
  const step = Math.max(1, Math.floor(fileCount / queryCount));

  for (let i = 0; i < fileCount; i += 1) {
    const moduleDir = `src/modules/m${Math.floor(i / 50)}`;
    const relPath = `${moduleDir}/file_${i}.ts`;
    const token = `ACC_NEEDLE_${i}`;
    const content = [
      `export const marker${i} = "${token}";`,
      "export function helper() { return true; }",
      ""
    ].join("\n");
    writeFile(root, relPath, content);
    if (i % step === 0 && expectedByQuery.size < queryCount) {
      expectedByQuery.set(token, normalizePath(relPath));
    }
  }

  const server = new SmartContextServer(root);
  const latencies = [];
  let hitsAt1 = 0;
  let hitsAtK = 0;
  let mrrSum = 0;

  try {
    await server.waitForInitialScan();
    for (const [query, expectedPath] of expectedByQuery.entries()) {
      const start = performance.now();
      const result = await runTool(server, "project_search", {
        query,
        type: "file",
        maxResults,
        matchesPerFile: 1,
        snippetLength: 80
      });
      latencies.push(performance.now() - start);
      const results = Array.isArray(result.results) ? result.results : [];
      const normalized = results.map((entry) => normalizePath(entry.path ?? ""));
      const rank = normalized.findIndex((entry) => entry === expectedPath);
      if (rank === 0) hitsAt1 += 1;
      if (rank >= 0 && rank < maxResults) hitsAtK += 1;
      if (rank >= 0) mrrSum += 1 / (rank + 1);
    }
  } finally {
    await server.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const totalQueries = expectedByQuery.size;
  const precisionAt1 = totalQueries > 0 ? hitsAt1 / totalQueries : 0;
  const precisionAtK = totalQueries > 0 ? hitsAtK / (totalQueries * maxResults) : 0;
  const recallAtK = totalQueries > 0 ? hitsAtK / totalQueries : 0;
  const mrr = totalQueries > 0 ? mrrSum / totalQueries : 0;

  const thresholds = {
    minMrr: parseNumberEnv(process.env.KAIRO_ADR088_SEARCH_MIN_MRR, undefined),
    minPrecisionAt1: parseNumberEnv(process.env.KAIRO_ADR088_SEARCH_MIN_P1, undefined),
    minRecallAtK: parseNumberEnv(process.env.KAIRO_ADR088_SEARCH_MIN_RK, undefined)
  };

  const report = {
    config: { fileCount, queryCount: totalQueries, maxResults },
    metrics: {
      precisionAt1,
      precisionAtK,
      recallAtK,
      mrr,
      hitsAt1,
      hitsAtK
    },
    latencyMs: {
      avg: latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95)
    },
    thresholds
  };

  const explicitReportPath = process.env.KAIRO_ADR088_SEARCH_REPORT_PATH;
  const defaultReportDir = path.join(process.cwd(), "benchmarks", "reports");
  const reportPath = explicitReportPath
    ? path.resolve(process.cwd(), explicitReportPath)
    : path.join(defaultReportDir, `adr-088-search-accuracy-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Wrote ADR-088 search accuracy report to ${reportPath}`);

  const failures = [];
  if (Number.isFinite(thresholds.minMrr) && mrr < thresholds.minMrr) {
    failures.push(`mrr=${mrr.toFixed(3)} < ${thresholds.minMrr}`);
  }
  if (Number.isFinite(thresholds.minPrecisionAt1) && precisionAt1 < thresholds.minPrecisionAt1) {
    failures.push(`precision@1=${precisionAt1.toFixed(3)} < ${thresholds.minPrecisionAt1}`);
  }
  if (Number.isFinite(thresholds.minRecallAtK) && recallAtK < thresholds.minRecallAtK) {
    failures.push(`recall@${maxResults}=${recallAtK.toFixed(3)} < ${thresholds.minRecallAtK}`);
  }

  if (failures.length > 0) {
    console.error("ADR-088 search accuracy thresholds failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("ADR-088 search accuracy run failed:", error);
  process.exitCode = 1;
});
