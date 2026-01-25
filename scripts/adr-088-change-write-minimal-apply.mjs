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

const waitForIndex = async (client, predicate, { timeoutMs = 60_000, intervalMs = 250 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;
  while (Date.now() < deadline) {
    const { payload } = await callToolJson(client, "manage", { command: "status", detail: "summary", suppressLogs: true });
    lastStatus = payload;
    if (predicate(payload)) return payload;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for index state. lastStatus=${JSON.stringify(lastStatus ?? null)}`);
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

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
};

const createFixtureRoot = ({ preset }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr088-change-write-minimal-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".kairo", "config"), { recursive: true });

  writeJson(path.join(root, ".kairo", "config", "mcp.json"), {
    version: 1,
    mode: "mcp",
    preset,
    publicSurface: "compact",
    applyHandshake: {
      required: true,
      tokenTtlMs: 30 * 60 * 1000,
      oneTime: true,
      invalidateOnDrift: true
    }
  });

  fs.writeFileSync(path.join(root, "README.md"), "# ADR-088 change/write minimal apply fixture\n", "utf-8");
  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 1;\n", "utf-8");

  return root;
};

const buildServerEnv = ({ preset }) => ({
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "production",
  KAIRO_MODE: "mcp",
  KAIRO_PUBLIC_SURFACE: "compact",
  KAIRO_PRESET: preset,
  KAIRO_WARMUP_ENABLED: "false",
  KAIRO_HEARTBEAT: "false",
  KAIRO_ALLOW_CWD_ROOT: "true",
  KAIRO_ALLOW_STDOUT_LOGS: "false",
  KAIRO_EXPOSE_INTERNAL_TOOLS: "false",
  KAIRO_EXPOSE_FILE_TOOLS: "false"
});

const closeDelay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const closeWithTimeout = async (label, fn, timeout = 10_000) => {
  try {
    await Promise.race([fn(), closeDelay(timeout)]);
  } catch (error) {
    console.warn(`[ADR-088 change/write minimal] ${label} failed:`, error);
  }
};

async function withServer({ serverPath, root, preset }, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, "--root", root],
    env: buildServerEnv({ preset }),
    stderr: "pipe"
  });
  const client = new Client({ name: "kairo-adr088-change-write-minimal", version: "0.1.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await closeWithTimeout("client.close", () => client.close());
    await closeWithTimeout("transport.close", () => transport.close());
  }
}

async function scenarioChangeMinimalApply({ client, root }) {
  const request = "Change src/value.ts export value from 1 to 2.";

  const plan = await callToolJson(client, "task", {
    request,
    mode: "plan_change",
    budget: "balanced",
    targetFiles: ["src/value.ts"],
    edits: [
      {
        filePath: "src/value.ts",
        targetString: "export const value = 1;\n",
        replacementString: "export const value = 2;\n"
      }
    ],
    output: { format: "summary" }
  });

  if (plan.payload?.ok !== true || plan.payload?.status !== "success") {
    throw new Error(`Expected plan_change success. payload=${JSON.stringify(plan.payload ?? null)}`);
  }
  const draftId = plan.payload?.draftId;
  const applyToken = plan.payload?.applyToken;
  if (typeof draftId !== "string" || draftId.length === 0) throw new Error("Missing draftId from plan_change");
  if (typeof applyToken !== "string" || applyToken.length === 0) throw new Error("Missing applyToken from plan_change");

  const apply = await callToolJson(client, "task", {
    request,
    mode: "apply_change",
    budget: "balanced",
    draftId,
    applyToken,
    output: { format: "summary" }
  });
  if (apply.payload?.ok !== true || apply.payload?.status !== "success") {
    throw new Error(`Expected apply_change success with minimal args. payload=${JSON.stringify(apply.payload ?? null)}`);
  }

  const updated = fs.readFileSync(path.join(root, "src", "value.ts"), "utf-8");
  if (!updated.includes("export const value = 2;")) {
    throw new Error(`Expected src/value.ts to be updated. content=${JSON.stringify(updated)}`);
  }

  const applyAgain = await callToolJson(client, "task", {
    request,
    mode: "apply_change",
    budget: "balanced",
    draftId,
    applyToken,
    output: { format: "summary" }
  });
  const blocked =
    applyAgain.payload?.ok === true &&
    (applyAgain.payload?.status === "blocked" || applyAgain.payload?.status === "partial_success") &&
    Array.isArray(applyAgain.payload?.degradedReasons) &&
    applyAgain.payload.degradedReasons.some((entry) => entry?.type?.includes("apply_token"));
  if (!blocked) {
    throw new Error(`Expected apply token to be rejected on reuse. payload=${JSON.stringify(applyAgain.payload ?? null)}`);
  }

  return {
    ok: true,
    draftId,
    applyToken
  };
}

async function scenarioWriteMinimalApply({ client, root }) {
  const targetPath = "src/generated.ts";
  const request = ["Create src/generated.ts with this content:", "", "```ts", "export const generated = 123;", "```", ""].join(
    "\n"
  );

  const plan = await callToolJson(client, "task", {
    request,
    mode: "write",
    safety: "plan",
    budget: "balanced",
    targetPath,
    output: { format: "summary" }
  });
  if (plan.payload?.ok !== true || plan.payload?.status !== "success") {
    throw new Error(`Expected write(plan) success. payload=${JSON.stringify(plan.payload ?? null)}`);
  }
  const draftId = plan.payload?.draftId;
  const applyToken = plan.payload?.applyToken;
  if (typeof draftId !== "string" || draftId.length === 0) throw new Error("Missing draftId from write(plan)");
  if (typeof applyToken !== "string" || applyToken.length === 0) throw new Error("Missing applyToken from write(plan)");

  const apply = await callToolJson(client, "task", {
    request,
    mode: "write",
    safety: "apply",
    budget: "balanced",
    draftId,
    applyToken,
    output: { format: "summary" }
  });
  if (apply.payload?.ok !== true || apply.payload?.status !== "success") {
    throw new Error(`Expected write(apply) success with minimal args. payload=${JSON.stringify(apply.payload ?? null)}`);
  }

  const written = fs.readFileSync(path.join(root, targetPath), "utf-8");
  if (!written.includes("export const generated = 123;")) {
    throw new Error(`Expected ${targetPath} to be written. content=${JSON.stringify(written)}`);
  }

  const applyAgain = await callToolJson(client, "task", {
    request,
    mode: "write",
    safety: "apply",
    budget: "balanced",
    draftId,
    applyToken,
    output: { format: "summary" }
  });
  const blocked =
    applyAgain.payload?.ok === true &&
    (applyAgain.payload?.status === "blocked" || applyAgain.payload?.status === "partial_success") &&
    Array.isArray(applyAgain.payload?.degradedReasons) &&
    applyAgain.payload.degradedReasons.some((entry) => entry?.type?.includes("apply_token"));
  if (!blocked) {
    throw new Error(`Expected apply token to be rejected on reuse. payload=${JSON.stringify(applyAgain.payload ?? null)}`);
  }

  return {
    ok: true,
    draftId,
    applyToken
  };
}

async function runPreset({ preset, serverPath }) {
  const root = createFixtureRoot({ preset });
  const startedAt = Date.now();
  const scenarios = [];

  try {
    await withServer({ serverPath, root, preset }, async (client) => {
      const runScenario = async (id, fn) => {
        const started = performance.now();
        try {
          const result = await fn({ client, root });
          scenarios.push({ id, ok: true, latencyMs: performance.now() - started, result });
        } catch (error) {
          scenarios.push({
            id,
            ok: false,
            latencyMs: performance.now() - started,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      };

      await callToolJson(client, "manage", { command: "reindex" });
      await waitForIndexHealthy(client, { timeoutMs: 120_000 });

      await runScenario("change.minimal_apply", scenarioChangeMinimalApply);
      await runScenario("write.minimal_apply", scenarioWriteMinimalApply);
    });
  } finally {
    const keep = process.env.KAIRO_ADR088_KEEP_TMP === "true";
    if (!keep) {
      fs.rmSync(root, { recursive: true, force: true });
    } else {
      console.log(`[ADR-088 change/write minimal] Keeping temp root: ${root}`);
    }
  }

  const passed = scenarios.filter((s) => s.ok).length;
  const failed = scenarios.length - passed;
  return {
    preset,
    startedAt,
    finishedAt: Date.now(),
    wallTimeMs: Date.now() - startedAt,
    scenarios,
    summary: { total: scenarios.length, passed, failed }
  };
}

async function run() {
  const serverPath = ensureDistServer();

  const rawPresets = process.env.KAIRO_ADR088_PRESETS ?? "mcp-lean,mcp-balanced,mcp-deep";
  const presets = rawPresets
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (presets.length === 0) {
    throw new Error("No presets provided (KAIRO_ADR088_PRESETS).");
  }

  const runs = [];
  for (const preset of presets) {
    console.log(`[ADR-088] Running change/write minimal-apply suite for preset=${preset}`);
    runs.push(await runPreset({ preset, serverPath }));
  }

  const report = {
    meta: {
      id: "adr-088-change-write-minimal-apply",
      createdAt: Date.now(),
      presets,
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "production",
        KAIRO_MODE: "mcp",
        KAIRO_PUBLIC_SURFACE: "compact"
      }
    },
    runs
  };

  const explicitReportPath = process.env.KAIRO_ADR088_CHANGE_WRITE_REPORT_PATH;
  const defaultReportDir = path.join(process.cwd(), "benchmarks", "reports");
  const reportPath = explicitReportPath
    ? path.resolve(process.cwd(), explicitReportPath)
    : path.join(defaultReportDir, `adr-088-change-write-minimal-apply-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Wrote ADR-088 change/write minimal-apply report to ${reportPath}`);

  const failures = [];
  for (const runEntry of runs) {
    for (const scenario of runEntry.scenarios) {
      if (!scenario.ok) {
        failures.push(`[${runEntry.preset}] ${scenario.id}: ${scenario.error ?? "unknown error"}`);
      }
    }
  }
  if (failures.length > 0) {
    console.error("ADR-088 change/write minimal-apply gate failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("ADR-088 change/write minimal-apply run failed:", error);
  process.exitCode = 1;
});

