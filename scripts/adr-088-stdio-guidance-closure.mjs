import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureDistServer = () => {
  const distPath = path.resolve(process.cwd(), "dist", "index.js");
  if (!fs.existsSync(distPath)) {
    throw new Error(`dist server not found: ${distPath}. Run \`npm run build\` first.`);
  }
  return distPath;
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

const unwrapToolResult = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (typeof payload.success === "boolean" && "result" in payload) {
    return payload.result;
  }
  return payload;
};

const callToolJson = async (client, name, args) => {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args });
  const latencyMs = performance.now() - started;
  const { text, payload } = parseToolJson(result, name);
  return { latencyMs, text, payload: unwrapToolResult(payload) };
};

const extractGuidanceToolCalls = (payload) => {
  const guidance = payload?.guidance ?? {};
  const calls = [];
  if (Array.isArray(guidance.suggestedActions)) {
    for (const action of guidance.suggestedActions) {
      const tool = action?.toolCall?.tool;
      if (typeof tool === "string") {
        calls.push({ tool, args: action?.toolCall?.args ?? {}, source: "suggestedActions" });
      }
    }
  }
  if (Array.isArray(guidance.nextCalls)) {
    for (const call of guidance.nextCalls) {
      const tool = call?.tool;
      if (typeof tool === "string") {
        calls.push({ tool, args: call?.args ?? {}, source: "nextCalls" });
      }
    }
  }
  return calls;
};

const assertCompactGuidance = (payload, { requireAtLeastOne = false } = {}) => {
  const calls = extractGuidanceToolCalls(payload);
  if (requireAtLeastOne && calls.length === 0) {
    throw new Error("Expected at least one guidance tool call but none were returned.");
  }
  const invalid = calls.filter((entry) => !["task", "manage"].includes(entry.tool));
  if (invalid.length > 0) {
    const tools = invalid.map((entry) => entry.tool).join(", ");
    throw new Error(`Non-compact tool calls detected: ${tools}`);
  }
  return calls;
};

const findTaskCall = (calls, predicate) => calls.find((call) => call.tool === "task" && predicate(call.args ?? {}));
const findManageCall = (calls, predicate) => calls.find((call) => call.tool === "manage" && predicate(call.args ?? {}));

const waitForIndex = async (client, predicate, { timeoutMs = 30_000, intervalMs = 250 } = {}) => {
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

const waitForWorkspaceDrift = async (client, predicate, opts) =>
  waitForIndex(
    client,
    (status) => {
      const drift = status?.drift ?? {};
      return predicate(drift);
    },
    opts
  );

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
};

const createFixtureRoot = ({ preset }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr088-closure-"));
  fs.mkdirSync(path.join(root, "src", "stale"), { recursive: true });
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
    },
    autopilot: {
      autoModeNeverApplies: true,
      defaultOutputFormat: "summary",
      maxAutoRepairAttempts: 0,
      allowAutoReindex: false
    }
  });

  fs.writeFileSync(path.join(root, "README.md"), "# ADR-088 stdio guidance closure fixture\n", "utf-8");
  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 1;\n", "utf-8");

  for (let i = 0; i < 40; i += 1) {
    fs.writeFileSync(
      path.join(root, "src", "stale", `file_${i}.ts`),
      `export const marker_${i} = "STALE_${i}";\n`,
      "utf-8"
    );
  }

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
  KAIRO_STORAGE_MODE: process.env.KAIRO_STORAGE_MODE ?? "memory",
  KAIRO_EXPOSE_FILE_TOOLS: "false"
});

async function withServer({ serverPath, root, preset }, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, "--root", root],
    env: buildServerEnv({ preset }),
    stderr: "pipe"
  });
  const client = new Client({ name: "kairo-adr088-stdio-guidance-closure", version: "0.1.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    try {
      await client.close();
    } catch {}
    try {
      await transport.close();
    } catch {}
  }
}

async function scenarioToolSurfaceCompact({ client }) {
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  if (names.join(",") !== "manage,task") {
    throw new Error(`Expected compact tool surface [manage,task], got: ${names.join(", ")}`);
  }
}

async function scenarioChangePlanApplyVerify({ client, root }) {
  const plan = await callToolJson(client, "task", {
    request: "Change src/value.ts export value from 1 to 2.",
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
  const planPayload = plan.payload;
  if (planPayload?.ok !== true || planPayload?.status !== "success") {
    throw new Error(`Expected plan_change success. payload=${JSON.stringify(planPayload)}`);
  }
  if (typeof planPayload?.draftId !== "string" || planPayload.draftId.length === 0) {
    throw new Error("Expected plan_change to return draftId");
  }
  if (typeof planPayload?.applyToken !== "string" || planPayload.applyToken.length === 0) {
    throw new Error("Expected plan_change to return applyToken");
  }

  const planCalls = assertCompactGuidance(planPayload, { requireAtLeastOne: true });
  const applyCall = findTaskCall(
    planCalls,
    (args) =>
      args?.mode === "apply_change" &&
      args?.draftId === planPayload.draftId &&
      args?.applyToken === planPayload.applyToken
  );
  if (!applyCall) {
    throw new Error(`Expected plan_change guidance to include task(apply_change) with applyToken/draftId. calls=${JSON.stringify(planCalls)}`);
  }

  const apply = await callToolJson(client, "task", applyCall.args);
  const applyPayload = apply.payload;
  if (applyPayload?.ok !== true || applyPayload?.status !== "success") {
    throw new Error(`Expected apply_change success. payload=${JSON.stringify(applyPayload)}`);
  }

  const updated = fs.readFileSync(path.join(root, "src", "value.ts"), "utf-8");
  if (!updated.includes("export const value = 2;")) {
    throw new Error("Expected src/value.ts to be updated to value=2");
  }

  if (applyPayload?.verification?.contentMatch !== true) {
    throw new Error(`Expected auto-verify contentMatch=true (balanced budget). verification=${JSON.stringify(applyPayload?.verification ?? null)}`);
  }
}

async function scenarioWritePlanApply({ client, root }) {
  const request = [
    "Create src/generated.ts with this content:",
    "",
    "```ts",
    "export const generated = 123;",
    "```",
    ""
  ].join("\n");

  const plan = await callToolJson(client, "task", {
    request,
    mode: "write",
    budget: "balanced",
    safety: "plan",
    targetPath: "src/generated.ts",
    output: { format: "summary" }
  });

  const planPayload = plan.payload;
  if (planPayload?.ok !== true || planPayload?.status !== "success") {
    throw new Error(`Expected write(plan) success. payload=${JSON.stringify(planPayload)}`);
  }
  if (typeof planPayload?.draftId !== "string" || planPayload.draftId.length === 0) {
    throw new Error("Expected write(plan) to return draftId");
  }
  if (typeof planPayload?.applyToken !== "string" || planPayload.applyToken.length === 0) {
    throw new Error("Expected write(plan) to return applyToken");
  }

  const planCalls = assertCompactGuidance(planPayload, { requireAtLeastOne: true });
  const applyCall = findTaskCall(
    planCalls,
    (args) =>
      args?.mode === "write" &&
      args?.safety === "apply" &&
      args?.draftId === planPayload.draftId &&
      args?.applyToken === planPayload.applyToken
  );
  if (!applyCall) {
    throw new Error(`Expected write(plan) guidance to include task(write apply) with applyToken/draftId. calls=${JSON.stringify(planCalls)}`);
  }

  const apply = await callToolJson(client, "task", applyCall.args);
  const applyPayload = apply.payload;
  if (applyPayload?.ok !== true || applyPayload?.status !== "success") {
    throw new Error(`Expected write(apply) success. payload=${JSON.stringify(applyPayload)}`);
  }

  const written = fs.readFileSync(path.join(root, "src", "generated.ts"), "utf-8");
  if (!written.includes("export const generated = 123;")) {
    throw new Error("Expected src/generated.ts to be written with drafted content");
  }
  if (applyPayload?.verification?.contentMatch !== true) {
    throw new Error(`Expected auto-verify contentMatch=true (balanced budget). verification=${JSON.stringify(applyPayload?.verification ?? null)}`);
  }
}

async function scenarioExternalDriftRepair({ client, root }) {
  await waitForIndexHealthy(client, { timeoutMs: 60_000 });

  fs.writeFileSync(path.join(root, "src", "value.ts"), `export const value = 999;\n`, "utf-8");
  for (let i = 0; i < 8; i += 1) {
    fs.writeFileSync(path.join(root, "src", "stale", `file_${i}.ts`), `export const marker_${i} = "DRIFT_${i}_${Date.now()}";\n`, "utf-8");
  }

  const driftDetected = await waitForWorkspaceDrift(
    client,
    (drift) => drift?.workspaceDrift === "detected",
    { timeoutMs: 15_000 }
  );
  const repairActions = driftDetected?.drift?.repairActions ?? [];
  if (!Array.isArray(repairActions) || repairActions.length === 0) {
    throw new Error(`Expected drift repairActions to be present. drift=${JSON.stringify(driftDetected?.drift ?? null)}`);
  }
  const reindexAction = repairActions.find((action) => action?.tool === "manage" && action?.args?.command === "reindex");
  if (!reindexAction?.args) {
    throw new Error(`Expected drift to suggest manage reindex. repairActions=${JSON.stringify(repairActions)}`);
  }

  await callToolJson(client, "manage", reindexAction.args);
  await waitForIndexHealthy(client, { timeoutMs: 120_000 });
  await waitForWorkspaceDrift(
    client,
    (drift) => drift?.workspaceDrift === "clean",
    { timeoutMs: 60_000 }
  );
}

async function runPreset({ preset, serverPath }) {
  const root = createFixtureRoot({ preset });
  const startedAt = Date.now();
  const scenarioResults = [];

  try {
    await withServer({ serverPath, root, preset }, async (client) => {
      const runScenario = async (id, fn) => {
        const started = performance.now();
        try {
          await fn({ client, root });
          scenarioResults.push({ id, ok: true, latencyMs: performance.now() - started });
        } catch (error) {
          scenarioResults.push({
            id,
            ok: false,
            latencyMs: performance.now() - started,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      };

      await runScenario("A1.tool_surface_compact", scenarioToolSurfaceCompact);

      await callToolJson(client, "manage", { command: "reindex" });
      await waitForIndexHealthy(client, { timeoutMs: 60_000 });

      await runScenario("C.plan_apply_verify_change", scenarioChangePlanApplyVerify);
      await callToolJson(client, "manage", { command: "reindex" });
      await waitForIndexHealthy(client, { timeoutMs: 60_000 });

      await runScenario("D.write_plan_apply", scenarioWritePlanApply);
      await callToolJson(client, "manage", { command: "reindex" });
      await waitForIndexHealthy(client, { timeoutMs: 60_000 });

      await runScenario("J2.external_drift_repair", scenarioExternalDriftRepair);
    });
  } finally {
    const keep = process.env.KAIRO_ADR088_KEEP_TMP === "true";
    if (!keep) {
      fs.rmSync(root, { recursive: true, force: true });
    } else {
      console.log(`[ADR-088] Keeping temp root: ${root}`);
    }
  }

  const passed = scenarioResults.filter((s) => s.ok).length;
  const failed = scenarioResults.length - passed;
  return {
    preset,
    startedAt,
    finishedAt: Date.now(),
    wallTimeMs: Date.now() - startedAt,
    scenarios: scenarioResults,
    summary: {
      total: scenarioResults.length,
      passed,
      failed
    }
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
    console.log(`[ADR-088] Running stdio guidance closure suite for preset=${preset}`);
    runs.push(await runPreset({ preset, serverPath }));
  }

  const report = {
    meta: {
      id: "adr-088-stdio-guidance-closure",
      createdAt: Date.now(),
      presets,
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "production",
        KAIRO_MODE: "mcp",
        KAIRO_PUBLIC_SURFACE: "compact",
        KAIRO_EXPOSE_FILE_TOOLS: "false"
      }
    },
    runs
  };

  const explicitReportPath = process.env.KAIRO_ADR088_CLOSURE_REPORT_PATH;
  const defaultReportDir = path.join(process.cwd(), "benchmarks", "reports");
  const reportPath = explicitReportPath
    ? path.resolve(process.cwd(), explicitReportPath)
    : path.join(defaultReportDir, `adr-088-stdio-guidance-closure-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Wrote ADR-088 stdio guidance closure report to ${reportPath}`);

  const failures = [];
  for (const run of runs) {
    for (const scenario of run.scenarios) {
      if (!scenario.ok) {
        failures.push(`[${run.preset}] ${scenario.id}: ${scenario.error ?? "unknown error"}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("ADR-088 stdio guidance closure gate failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("ADR-088 stdio guidance closure run failed:", error);
  process.exitCode = 1;
});
