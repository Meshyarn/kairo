import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const ensureDistServer = () => {
  const distPath = path.resolve(process.cwd(), "dist", "index.js");
  if (!fs.existsSync(distPath)) {
    throw new Error(`dist server not found: ${distPath}. Run \`npm run build\` first.`);
  }
  return distPath;
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

const unwrapToolResult = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (typeof payload.success === "boolean" && "result" in payload) {
    return payload.result;
  }
  return payload;
};

const parseToolJson = (toolResult, label) => {
  const text = toolResult?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`Missing MCP tool response text for ${label}`);
  }
  try {
    return { text, payload: JSON.parse(text) };
  } catch (error) {
    const preview = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    throw new Error(`Failed to parse MCP tool response JSON for ${label}: ${error?.message ?? error}\n${preview}`);
  }
};

const callToolJson = async (client, name, args) => {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args });
  const latencyMs = performance.now() - started;
  const { text, payload } = parseToolJson(result, name);
  return { latencyMs, text, payload: unwrapToolResult(payload) };
};

const waitForIndex = async (client, predicate, { timeoutMs = 120_000, intervalMs = 500 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;
  while (Date.now() < deadline) {
    const { payload } = await callToolJson(client, "manage", { command: "status", detail: "summary", suppressLogs: true });
    lastStatus = payload;
    if (predicate(payload)) return payload;
    await sleep(intervalMs);
  }
  const error = new Error(`Timed out waiting for index state. lastStatus=${JSON.stringify(lastStatus ?? null)}`);
  error.lastStatus = lastStatus;
  throw error;
};

const waitForIndexHealthy = async (client, opts) =>
  waitForIndex(
    client,
    (status) => {
      const snapshot = status?.indexSnapshot ?? {};
      const dirty = Number(snapshot?.dirtyFileCount ?? 0);
      const staleRisk = snapshot?.staleRisk ?? "unknown";
      const reindexInProgress = Boolean(status?.activity?.reindexInProgress);
      const lastReindex = status?.activity?.lastReindex;
      const lastReindexSuccess = typeof lastReindex?.success === "boolean" ? lastReindex.success : undefined;
      if (lastReindexSuccess === false) return false;
      return !reindexInProgress && dirty === 0 && staleRisk !== "high";
    },
    opts
  );

const createLargeFixture = ({ fileCount, queryCount, preset }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr088-longrun-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".kairo", "config"), { recursive: true });

  fs.writeFileSync(
    path.join(root, ".kairo", "config", "mcp.json"),
    JSON.stringify(
      {
        version: 1,
        mode: "mcp",
        preset,
        publicSurface: "compact",
        applyHandshake: { required: true, tokenTtlMs: 30 * 60 * 1000, oneTime: true, invalidateOnDrift: true }
      },
      null,
      2
    ),
    "utf-8"
  );

  fs.writeFileSync(path.join(root, "README.md"), "# ADR-088 long-run fixture\n", "utf-8");

  const expectedByQuery = new Map();
  const step = Math.max(1, Math.floor(fileCount / queryCount));
  for (let i = 0; i < fileCount; i += 1) {
    const moduleDir = `src/modules/m${Math.floor(i / 200)}`;
    const relPath = `${moduleDir}/file_${i}.ts`;
    const token = `LR_NEEDLE_${i}`;
    const content = [
      `export const marker${i} = "${token}";`,
      "export function helper() { return true; }",
      ""
    ].join("\n");
    fs.mkdirSync(path.join(root, path.dirname(relPath)), { recursive: true });
    fs.writeFileSync(path.join(root, relPath), content, "utf-8");
    if (i % step === 0 && expectedByQuery.size < queryCount) {
      expectedByQuery.set(token, normalizePath(relPath));
    }
  }

  return { root, expectedByQuery };
};

const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 100) / 100;

async function run() {
  const serverPath = ensureDistServer();

  const fileCount = Math.max(100, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_LONGRUN_FILE_COUNT, 10_000)));
  const queryCount = Math.max(20, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_LONGRUN_QUERY_COUNT, 200)));
  const maxResults = Math.max(1, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_LONGRUN_MAX_RESULTS, 5)));
  const sampleEvery = Math.max(1, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_LONGRUN_SAMPLE_EVERY, 25)));
  const preset = (process.env.KAIRO_ADR088_LONGRUN_PRESET ?? "mcp-balanced").trim() || "mcp-balanced";
  const configuredTimeoutMs = parseNumberEnv(process.env.KAIRO_ADR088_LONGRUN_TIMEOUT_MS, undefined);
  const defaultTimeoutMs = fileCount >= 10_000 ? 30 * 60_000 : 15 * 60_000;
  const timeoutMs = Math.max(60_000, Math.floor(configuredTimeoutMs ?? defaultTimeoutMs));

  const thresholds = {
    maxRssMb: parseNumberEnv(process.env.KAIRO_ADR088_LONGRUN_MAX_RSS_MB, undefined),
    maxP95SearchMs: parseNumberEnv(process.env.KAIRO_ADR088_LONGRUN_MAX_P95_SEARCH_MS, undefined),
    requireDriftClean: (process.env.KAIRO_ADR088_LONGRUN_REQUIRE_DRIFT_CLEAN ?? "true").trim().toLowerCase() === "true"
  };

  console.log(
    `[ADR-088 long-run] Generating fixture: files=${fileCount} queries=${queryCount} maxResults=${maxResults} preset=${preset}`
  );
  const { root, expectedByQuery } = createLargeFixture({ fileCount, queryCount, preset });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, "--root", root],
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? "production",
      KAIRO_MODE: "mcp",
      KAIRO_PUBLIC_SURFACE: "compact",
      KAIRO_PRESET: preset,
      KAIRO_ALLOW_CWD_ROOT: "true",
      KAIRO_WARMUP_ENABLED: "false",
      KAIRO_HEARTBEAT: "false",
      KAIRO_ALLOW_STDOUT_LOGS: "false",
      KAIRO_EXPOSE_INTERNAL_TOOLS: "true",
      KAIRO_EXPOSE_FILE_TOOLS: "false"
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "kairo-adr088-long-run", version: "0.1.0" });

  const startedAt = Date.now();
  const samples = [];
  const searchLatencies = [];
  let hitsAt1 = 0;
  let hitsAtK = 0;
  let mrrSum = 0;
  let phase = "init";
  let failureError;
  let reindexWaitMs;

  try {
    phase = "connect";
    console.log("[ADR-088 long-run] Starting MCP server...");
    await client.connect(transport);

    phase = "reindex";
    console.log("[ADR-088 long-run] Starting reindex...");
    const reindexStartedAt = Date.now();
    await callToolJson(client, "manage", { command: "reindex" });
    console.log("[ADR-088 long-run] Waiting for index healthy...");
    await waitForIndexHealthy(client, { timeoutMs });
    reindexWaitMs = Date.now() - reindexStartedAt;

    phase = "baseline_status";
    const baselineStatus = await callToolJson(client, "manage", { command: "status", detail: "summary", suppressLogs: true });
    samples.push({
      ts: Date.now(),
      label: "baseline",
      indexSnapshot: baselineStatus.payload?.indexSnapshot,
      drift: baselineStatus.payload?.drift,
      processStats: baselineStatus.payload?.processStats
    });

    phase = "search_loop";
    console.log("[ADR-088 long-run] Running search loop...");
    for (const [query, expectedPath] of expectedByQuery.entries()) {
      const result = await callToolJson(client, "project_search", {
        query,
        type: "file",
        maxResults,
        matchesPerFile: 1,
        snippetLength: 80
      });
      searchLatencies.push(result.latencyMs);
      const results = Array.isArray(result.payload?.results) ? result.payload.results : [];
      const normalized = results.map((entry) => normalizePath(entry.path ?? ""));
      const rank = normalized.findIndex((entry) => entry === expectedPath);
      if (rank === 0) hitsAt1 += 1;
      if (rank >= 0 && rank < maxResults) hitsAtK += 1;
      if (rank >= 0) mrrSum += 1 / (rank + 1);

      if (searchLatencies.length % sampleEvery === 0) {
        phase = `status_sample_${searchLatencies.length}`;
        const status = await callToolJson(client, "manage", { command: "status", detail: "summary", suppressLogs: true });
        samples.push({
          ts: Date.now(),
          label: `sample_${searchLatencies.length}`,
          indexSnapshot: status.payload?.indexSnapshot,
          drift: status.payload?.drift,
          processStats: status.payload?.processStats
        });
      }
    }

    phase = "final_status";
    console.log("[ADR-088 long-run] Capturing final status...");
    const finalStatus = await callToolJson(client, "manage", { command: "status", detail: "summary", suppressLogs: true });
    samples.push({
      ts: Date.now(),
      label: "final",
      indexSnapshot: finalStatus.payload?.indexSnapshot,
      drift: finalStatus.payload?.drift,
      processStats: finalStatus.payload?.processStats
    });

    console.log("[ADR-088 long-run] Tool loop complete.");
  } catch (error) {
    failureError = error;
  } finally {
    console.log("[ADR-088 long-run] Closing MCP client/transport...");
    const closeDelay = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    const closeWithTimeout = async (label, fn, timeout = 10_000) => {
      try {
        await Promise.race([fn(), closeDelay(timeout)]);
      } catch (error) {
        console.warn(`[ADR-088 long-run] ${label} failed:`, error);
      }
    };
    try {
      await closeWithTimeout("client.close", () => client.close());
    } catch {}
    try {
      await closeWithTimeout("transport.close", () => transport.close());
    } catch {}
    console.log("[ADR-088 long-run] Closed MCP client/transport.");
    const keep = process.env.KAIRO_ADR088_KEEP_TMP === "true";
    if (!keep) {
      fs.rmSync(root, { recursive: true, force: true });
    } else {
      console.log(`[ADR-088] Keeping temp root: ${root}`);
    }
  }

  console.log("[ADR-088 long-run] Computing report...");
  const totalQueries = expectedByQuery.size;
  const precisionAt1 = totalQueries > 0 ? hitsAt1 / totalQueries : 0;
  const precisionAtK = totalQueries > 0 ? hitsAtK / (totalQueries * maxResults) : 0;
  const recallAtK = totalQueries > 0 ? hitsAtK / totalQueries : 0;
  const mrr = totalQueries > 0 ? mrrSum / totalQueries : 0;

  const rssSamples = samples
    .map((entry) => entry?.processStats?.memoryBytes?.rss)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const maxRss = rssSamples.length > 0 ? Math.max(...rssSamples) : null;
  const maxRssMb = typeof maxRss === "number" ? mb(maxRss) : null;

  const report = {
    meta: {
      id: "adr-088-long-run",
      createdAt: Date.now(),
      startedAt,
      finishedAt: Date.now(),
      wallTimeMs: Date.now() - startedAt,
      preset,
      config: { fileCount, queryCount: totalQueries, maxResults, sampleEvery, timeoutMs },
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "production",
        KAIRO_MODE: "mcp",
        KAIRO_PUBLIC_SURFACE: "compact",
        KAIRO_EXPOSE_INTERNAL_TOOLS: "true"
      },
      outcome: {
        ok: !failureError,
        phase,
        ...(failureError
          ? {
              error: {
                message: failureError?.message ?? String(failureError),
                stack: typeof failureError?.stack === "string" ? failureError.stack : undefined,
                lastStatus: failureError?.lastStatus
              }
            }
          : {})
      },
      thresholds
    },
    metrics: {
      search: {
        precisionAt1,
        precisionAtK,
        recallAtK,
        mrr,
        hitsAt1,
        hitsAtK
      },
      latencyMs: {
        avg: searchLatencies.reduce((sum, value) => sum + value, 0) / Math.max(1, searchLatencies.length),
        p50: percentile(searchLatencies, 0.5),
        p95: percentile(searchLatencies, 0.95)
      },
      timings: {
        ...(Number.isFinite(reindexWaitMs) ? { reindexWaitMs } : {})
      },
      process: {
        maxRssBytes: maxRss,
        maxRssMb
      }
    },
    samples
  };

  const explicitReportPath = process.env.KAIRO_ADR088_LONGRUN_REPORT_PATH;
  const defaultReportDir = path.join(process.cwd(), "benchmarks", "reports");
  const reportPath = explicitReportPath
    ? path.resolve(process.cwd(), explicitReportPath)
    : path.join(defaultReportDir, `adr-088-long-run-${Date.now()}.json`);
  console.log(`[ADR-088 long-run] Writing report: ${reportPath}`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Wrote ADR-088 long-run report to ${reportPath}`);

  const failures = [];
  if (failureError) {
    failures.push(`exception=${failureError?.message ?? String(failureError)}`);
  }
  if (thresholds.requireDriftClean) {
    const lastDrift = samples[samples.length - 1]?.drift;
    if (lastDrift?.workspaceDrift && lastDrift.workspaceDrift !== "clean") {
      failures.push(`workspaceDrift=${lastDrift.workspaceDrift}`);
    }
  }
  if (Number.isFinite(thresholds.maxRssMb) && Number.isFinite(maxRssMb) && maxRssMb > thresholds.maxRssMb) {
    failures.push(`maxRssMb=${maxRssMb} > ${thresholds.maxRssMb}`);
  }
  const p95 = report.metrics.latencyMs.p95;
  if (Number.isFinite(thresholds.maxP95SearchMs) && Number.isFinite(p95) && p95 > thresholds.maxP95SearchMs) {
    failures.push(`p95SearchMs=${p95.toFixed(1)} > ${thresholds.maxP95SearchMs}`);
  }

  if (failures.length > 0) {
    console.error("ADR-088 long-run gate failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("ADR-088 long-run run failed:", error);
  process.exitCode = 1;
});
