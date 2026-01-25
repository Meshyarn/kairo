import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.KAIRO_MODE = process.env.KAIRO_MODE ?? "mcp";
process.env.KAIRO_PUBLIC_SURFACE = process.env.KAIRO_PUBLIC_SURFACE ?? "compact";
process.env.KAIRO_WARMUP_ENABLED = process.env.KAIRO_WARMUP_ENABLED ?? "false";
process.env.KAIRO_METRICS_MODE = process.env.KAIRO_METRICS_MODE ?? "basic";

const DEFAULT_THRESHOLDS = {
  askLatencyPerTokenMsP95: 50,
  planChangeLatencyMsP95: 8000,
  responseEnvelopeTokensP95: 4000
};

const SAMPLE_COUNT = parseNumberEnv(process.env.KAIRO_SLO_SAMPLE_COUNT, 10);

async function main() {
  const { SmartContextServer } = await import("../dist/index.js");
  const { estimateTokens } = await import("../dist/orchestration/TokenBudget.js");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-task-slo-"));
  const srcDir = path.join(root, "src");
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  fs.writeFileSync(
    path.join(srcDir, "main.ts"),
    [
      "export function main() {",
      "  const message = 'hello';",
      "  return message;",
      "}"
    ].join("\n") + "\n",
    "utf-8"
  );
  fs.writeFileSync(
    path.join(srcDir, "helper.ts"),
    "export const helper = () => 'helper';\n",
    "utf-8"
  );
  fs.writeFileSync(path.join(docsDir, "readme.md"), "# Docs\nSimple docs.\n", "utf-8");

  const server = new SmartContextServer(root);
  await server.waitForInitialScan();

  const askLatencies = [];
  const askLatencyPerToken = [];
  const planLatencies = [];
  const responseTokens = [];

  try {
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const askResult = await runTask(server, {
        request: "Summarize the main function behavior.",
        mode: "ask",
        budget: "lean",
        paths: ["src"],
        output: { format: "summary" }
      });
      const askTokens = estimateTokens(askResult.text, { languageId: "json" });
      const askTokenCount = Math.max(askTokens, 1);
      askLatencies.push(askResult.latencyMs);
      askLatencyPerToken.push(askResult.latencyMs / askTokenCount);
      responseTokens.push(askTokens);

      const planResult = await runTask(server, {
        request: "Rename the greeting message.",
        mode: "plan_change",
        budget: "lean",
        targetFiles: ["src/main.ts"],
        edits: [
          {
            filePath: "src/main.ts",
            targetString: "return message;",
            replacementString: "return message + ' world';"
          }
        ],
        output: { format: "summary" }
      });
      const planTokens = estimateTokens(planResult.text, { languageId: "json" });
      planLatencies.push(planResult.latencyMs);
      responseTokens.push(planTokens);
    }

    const thresholds = {
      askLatencyPerTokenMsP95: parseNumberEnv(
        process.env.KAIRO_SLO_ASK_LATENCY_PER_TOKEN_MS_P95,
        DEFAULT_THRESHOLDS.askLatencyPerTokenMsP95
      ),
      planChangeLatencyMsP95: parseNumberEnv(
        process.env.KAIRO_SLO_PLAN_CHANGE_LATENCY_MS_P95,
        DEFAULT_THRESHOLDS.planChangeLatencyMsP95
      ),
      responseEnvelopeTokensP95: parseNumberEnv(
        process.env.KAIRO_SLO_RESPONSE_TOKENS_P95,
        DEFAULT_THRESHOLDS.responseEnvelopeTokensP95
      )
    };

    const stats = {
      sampleCount: SAMPLE_COUNT,
      askLatencyPerTokenMsP95: percentile(askLatencyPerToken, 0.95),
      planChangeLatencyMsP95: percentile(planLatencies, 0.95),
      responseEnvelopeTokensP95: percentile(responseTokens, 0.95)
    };

    const report = {
      thresholds,
      stats,
      samples: {
        askLatencyMs: summarize(askLatencies),
        askLatencyPerTokenMs: summarize(askLatencyPerToken),
        planChangeLatencyMs: summarize(planLatencies),
        responseEnvelopeTokens: summarize(responseTokens)
      }
    };

    const reportDir = path.join("benchmarks", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `adr-084-task-slo-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`Wrote ADR-084 task SLO report to ${reportPath}`);

    const failures = [];
    if (!Number.isFinite(stats.askLatencyPerTokenMsP95) || stats.askLatencyPerTokenMsP95 > thresholds.askLatencyPerTokenMsP95) {
      failures.push(
        `task(ask) latency/token p95=${stats.askLatencyPerTokenMsP95.toFixed(2)}ms > ${thresholds.askLatencyPerTokenMsP95}ms`
      );
    }
    if (!Number.isFinite(stats.planChangeLatencyMsP95) || stats.planChangeLatencyMsP95 > thresholds.planChangeLatencyMsP95) {
      failures.push(
        `task(plan_change) latency p95=${stats.planChangeLatencyMsP95.toFixed(2)}ms > ${thresholds.planChangeLatencyMsP95}ms`
      );
    }
    if (!Number.isFinite(stats.responseEnvelopeTokensP95) || stats.responseEnvelopeTokensP95 > thresholds.responseEnvelopeTokensP95) {
      failures.push(
        `response envelope tokens p95=${stats.responseEnvelopeTokensP95.toFixed(2)} > ${thresholds.responseEnvelopeTokensP95}`
      );
    }

    if (failures.length > 0) {
      console.error("ADR-084 task SLO gate failed:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await server.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function runTask(server, args) {
  const started = performance.now();
  const response = await server.handleCallTool("task", args);
  const latencyMs = performance.now() - started;

  if (response?.isError) {
    const message = response?.content?.[0]?.text ?? response?.error ?? "Unknown error";
    throw new Error(`task failed: ${message}`);
  }

  const text = response?.content?.[0]?.text ?? "";
  if (!text) {
    throw new Error("task response missing content text");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`task response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (payload?.ok !== true) {
    throw new Error(`task did not complete successfully: ${text}`);
  }
  return { latencyMs, text };
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function summarize(values) {
  if (!Array.isArray(values) || values.length === 0) return {};
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95)
  };
}

function parseNumberEnv(raw, fallback) {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
