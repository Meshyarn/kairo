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

const normalizePath = (value) => value.replace(/\\/g, "/").replace(/^\.\//, "");

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
  if (Array.isArray(guidance.nextCalls)) {
    for (const call of guidance.nextCalls) {
      const tool = call?.tool;
      if (typeof tool === "string") {
        calls.push({ tool, args: call?.args ?? {}, source: "nextCalls" });
      }
    }
  }
  if (Array.isArray(guidance.suggestedActions)) {
    for (const action of guidance.suggestedActions) {
      const tool = action?.toolCall?.tool;
      if (typeof tool === "string") {
        calls.push({ tool, args: action?.toolCall?.args ?? {}, source: "suggestedActions" });
      }
    }
  }
  return calls;
};

const pickExecutableGuidance = (payload, { allowedTools }) => {
  const calls = extractGuidanceToolCalls(payload);
  return calls.find((call) => allowedTools.includes(call.tool));
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

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
};

const createFixtureRoot = ({ preset }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr088-agentloop-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
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
      maxAutoRepairAttempts: 1,
      allowAutoReindex: false
    }
  });

  fs.writeFileSync(path.join(root, "README.md"), "# ADR-088 agent-loop fixture\n", "utf-8");
  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 1;\n", "utf-8");
  fs.writeFileSync(
    path.join(root, "src", "math.ts"),
    ["export function add(a: number, b: number) { return a + b; }", ""].join("\n"),
    "utf-8"
  );

  for (let i = 0; i < 60; i += 1) {
    fs.writeFileSync(
      path.join(root, "src", "stale", `file_${i}.ts`),
      `export const marker_${i} = "AGENTLOOP_${i}";\n`,
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
    console.warn(`[ADR-088 agent-loop] ${label} failed:`, error);
  }
};

async function withServer({ serverPath, root, preset }, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, "--root", root],
    env: buildServerEnv({ preset }),
    stderr: "pipe"
  });
  const client = new Client({ name: "kairo-adr088-agent-loop", version: "0.1.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await closeWithTimeout("client.close", () => client.close());
    await closeWithTimeout("transport.close", () => transport.close());
  }
}

class AgentSimulator {
  constructor({ client, root, preset }) {
    this.client = client;
    this.root = root;
    this.preset = preset;
    this.allowedTools = ["task", "manage"];
    this.events = [];
  }

  async call(tool, args, { scenarioId, kind, note } = {}) {
    const startedAt = Date.now();
    const result = await callToolJson(this.client, tool, args);
    const payload = result.payload;
    const next = payload && typeof payload === "object" ? this.pickNext(payload) : undefined;
    const summary = {
      ok: payload?.ok,
      status: payload?.status,
      mode: payload?.mode,
      degraded: payload?.degraded,
      degradedReasonsCount: Array.isArray(payload?.degradedReasons) ? payload.degradedReasons.length : 0
    };
    this.events.push({
      ts: startedAt,
      scenarioId,
      kind: kind ?? "call",
      tool,
      args,
      latencyMs: result.latencyMs,
      summary,
      guidance: next
        ? {
            hasExecutableNextCall: true,
            nextTool: next.tool,
            nextSource: next.source
          }
        : { hasExecutableNextCall: false },
      note
    });
    return result;
  }

  pickNext(payload) {
    return pickExecutableGuidance(payload, { allowedTools: this.allowedTools });
  }

  async runGuided({ scenarioId, initial, maxSteps = 8, stop }) {
    const startedAt = performance.now();
    let steps = 0;
    let guidanceExpected = 0;
    let guidancePresent = 0;
    let last = await this.call(initial.tool, initial.args, { scenarioId, kind: "initial" });
    steps += 1;

    while (steps < maxSteps) {
      if (stop?.(last.payload)) break;
      guidanceExpected += 1;
      const next = this.pickNext(last.payload);
      if (!next) break;
      guidancePresent += 1;
      last = await this.call(next.tool, next.args, { scenarioId, kind: "follow_guidance", note: next.source });
      steps += 1;
    }

    const actionabilityRate = guidanceExpected > 0 ? guidancePresent / guidanceExpected : 1;
    return {
      ok: Boolean(stop?.(last.payload)),
      steps,
      latencyMs: performance.now() - startedAt,
      lastPayload: last.payload,
      trust: {
        actionabilityRate
      }
    };
  }
}

async function scenarioToolSurface({ client }) {
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  if (names.join(",") !== "manage,task") {
    throw new Error(`Expected compact tool surface [manage,task], got: ${names.join(", ")}`);
  }
}

async function scenarioChangeValue({ agent }) {
  const scenarioId = "S1.change_value_guided";
  const root = agent.root;
  const result = await agent.runGuided({
    scenarioId,
    initial: {
      tool: "task",
      args: {
        request: "Change src/value.ts export value from 1 to 2.",
        mode: "plan_change",
        budget: "balanced",
        targetFiles: ["src/value.ts"],
        output: { format: "summary" }
      }
    },
    maxSteps: 6,
    stop: (payload) => payload?.mode === "apply_change" && payload?.status === "success"
  });
  if (!result.ok) {
    throw new Error(`Failed to reach apply_change success. last=${JSON.stringify(result.lastPayload ?? null)}`);
  }
  const updated = fs.readFileSync(path.join(root, "src", "value.ts"), "utf-8");
  if (!updated.includes("export const value = 2;")) {
    throw new Error(`Expected src/value.ts to be updated. content=${JSON.stringify(updated)}`);
  }
  return result;
}

async function scenarioWriteSmart({ agent }) {
  const scenarioId = "S2.write_plan_apply_guided";
  const root = agent.root;
  const targetPath = "src/generated.ts";
  const result = await agent.runGuided({
    scenarioId,
    initial: {
      tool: "task",
      args: {
        request: "Create src/generated.ts exporting const generated = 123.",
        mode: "write",
        budget: "balanced",
        safety: "plan",
        targetPath,
        output: { format: "summary" }
      }
    },
    maxSteps: 8,
    stop: (payload) => payload?.mode === "write" && payload?.status === "success" && payload?.verification?.exists === true
  });
  if (!result.ok) {
    throw new Error(`Failed to reach write(apply) success. last=${JSON.stringify(result.lastPayload ?? null)}`);
  }
  const written = fs.readFileSync(path.join(root, normalizePath(targetPath)), "utf-8");
  if (!written.includes("generated") || !written.includes("123")) {
    throw new Error(`Expected ${targetPath} to be written. content=${JSON.stringify(written)}`);
  }
  return result;
}

async function scenarioApplyTokenDriftRecovery({ agent }) {
  const scenarioId = "S3.apply_drift_recovery_guided";
  const root = agent.root;

  const plan = await agent.call(
    "task",
    {
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
    },
    { scenarioId, kind: "initial" }
  );

  const applyCall = pickExecutableGuidance(plan.payload, { allowedTools: ["task"] });
  if (!applyCall || applyCall.tool !== "task") {
    throw new Error(`Expected plan_change to return task apply nextCall. payload=${JSON.stringify(plan.payload ?? null)}`);
  }

  fs.writeFileSync(
    path.join(root, "src", "value.ts"),
    `// drift ${Date.now()}\nexport const value = 1;\n`,
    "utf-8"
  );

  let last = await agent.call("task", applyCall.args, { scenarioId, kind: "follow_guidance", note: applyCall.source });
  let steps = 2;
  while (steps < 10) {
    if (last.payload?.mode === "apply_change" && last.payload?.status === "success") break;
    const next = agent.pickNext(last.payload);
    if (!next) break;
    last = await agent.call(next.tool, next.args, { scenarioId, kind: "follow_guidance", note: next.source });
    steps += 1;
  }

  const updated = fs.readFileSync(path.join(root, "src", "value.ts"), "utf-8");
  if (!updated.includes("export const value = 2;")) {
    throw new Error(
      `Expected drift recovery to converge to value=2. lastMode=${last.payload?.mode} lastStatus=${last.payload?.status} content=${JSON.stringify(updated)}`
    );
  }

  return {
    ok: last.payload?.mode === "apply_change" && last.payload?.status === "success",
    steps,
    lastPayload: last.payload
  };
}

async function scenarioBudgetPressure({ agent }) {
  const scenarioId = "S4.budget_pressure_json_valid";
  const result = await agent.call(
    "task",
    {
      request: "Analyze the codebase briefly and list key files.",
      mode: "analyze",
      budget: "balanced",
      output: { format: "summary", maxChars: 700 }
    },
    { scenarioId, kind: "initial" }
  );
  const payload = result.payload;
  if (!payload || payload.ok !== true) {
    throw new Error(`Expected ok=true. payload=${JSON.stringify(payload ?? null)}`);
  }
  const calls = extractGuidanceToolCalls(payload);
  const invalid = calls.filter((call) => !["task", "manage"].includes(call.tool));
  if (invalid.length > 0) {
    throw new Error(`Non-compact tool calls returned under budget pressure: ${invalid.map((c) => c.tool).join(", ")}`);
  }
  return { ok: true, steps: 1, lastPayload: payload };
}

async function runPreset({ preset, serverPath }) {
  const root = createFixtureRoot({ preset });
  const startedAt = Date.now();
  const scenarioResults = [];
  let failureError;

  try {
    await withServer({ serverPath, root, preset }, async (client) => {
      const agent = new AgentSimulator({ client, root, preset });

      const runScenario = async (id, fn) => {
        const started = performance.now();
        try {
          const result = await fn({ client, root, agent });
          scenarioResults.push({
            id,
            ok: true,
            latencyMs: performance.now() - started,
            ...(result?.steps ? { steps: result.steps } : {}),
            ...(result?.trust ? { trust: result.trust } : {})
          });
        } catch (error) {
          scenarioResults.push({
            id,
            ok: false,
            latencyMs: performance.now() - started,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      };

      await runScenario("S0.tool_surface_compact", async ({ client }) => {
        await scenarioToolSurface({ client });
        return { ok: true, steps: 0 };
      });

      await agent.call("manage", { command: "reindex" }, { scenarioId: "bootstrap", kind: "bootstrap" });
      await waitForIndexHealthy(client, { timeoutMs: 120_000 });

      await runScenario("S1.change_value_guided", scenarioChangeValue);
      await runScenario("S2.write_plan_apply_guided", scenarioWriteSmart);
      await runScenario("S3.apply_drift_recovery_guided", scenarioApplyTokenDriftRecovery);
      await runScenario("S4.budget_pressure_json_valid", scenarioBudgetPressure);

      const finalStatus = await agent.call("manage", { command: "status", detail: "summary", suppressLogs: true }, { scenarioId: "final" });
      scenarioResults.push({
        id: "S5.manage_status_has_processStats",
        ok: Boolean(finalStatus.payload?.processStats?.memoryBytes?.rss),
        latencyMs: finalStatus.latencyMs,
        details: {
          rss: finalStatus.payload?.processStats?.memoryBytes?.rss,
          heapUsed: finalStatus.payload?.processStats?.memoryBytes?.heapUsed
        }
      });
    });
  } catch (error) {
    failureError = error;
  } finally {
    const keep = process.env.KAIRO_ADR088_KEEP_TMP === "true";
    if (!keep) {
      fs.rmSync(root, { recursive: true, force: true });
    } else {
      console.log(`[ADR-088 agent-loop] Keeping temp root: ${root}`);
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
    ...(failureError
      ? { runError: { message: failureError instanceof Error ? failureError.message : String(failureError) } }
      : {}),
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
    console.log(`[ADR-088] Running agent-loop simulator suite for preset=${preset}`);
    runs.push(await runPreset({ preset, serverPath }));
  }

  const report = {
    meta: {
      id: "adr-088-agent-loop-simulator",
      createdAt: Date.now(),
      presets,
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "production",
        KAIRO_MODE: "mcp",
        KAIRO_PUBLIC_SURFACE: "compact",
        KAIRO_EXPOSE_INTERNAL_TOOLS: "false",
        KAIRO_EXPOSE_FILE_TOOLS: "false"
      }
    },
    runs
  };

  const explicitReportPath = process.env.KAIRO_ADR088_AGENT_LOOP_REPORT_PATH;
  const defaultReportDir = path.join(process.cwd(), "benchmarks", "reports");
  const reportPath = explicitReportPath
    ? path.resolve(process.cwd(), explicitReportPath)
    : path.join(defaultReportDir, `adr-088-agent-loop-simulator-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Wrote ADR-088 agent-loop simulator report to ${reportPath}`);

  const failures = [];
  for (const runEntry of runs) {
    if (runEntry.runError) {
      failures.push(`[${runEntry.preset}] run error: ${runEntry.runError.message}`);
      continue;
    }
    for (const scenario of runEntry.scenarios) {
      if (!scenario.ok) {
        failures.push(`[${runEntry.preset}] ${scenario.id}: ${scenario.error ?? "unknown error"}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("ADR-088 agent-loop simulator gate failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("ADR-088 agent-loop simulator run failed:", error);
  process.exitCode = 1;
});
