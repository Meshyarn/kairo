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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr088-change-write-deep-"));
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
    },
    autopilot: {
      autoModeNeverApplies: true,
      defaultOutputFormat: "summary",
      maxAutoRepairAttempts: 0,
      allowAutoReindex: false
    }
  });

  fs.writeFileSync(path.join(root, "README.md"), "# ADR-088 change/write deep fixture\n", "utf-8");
  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 1;\n", "utf-8");
  fs.writeFileSync(path.join(root, "src", "sentinel.ts"), "export const sentinel = \"OK\";\n", "utf-8");

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
    console.warn(`[ADR-088 change/write deep] ${label} failed:`, error);
  }
};

async function withServer({ serverPath, root, preset }, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, "--root", root],
    env: buildServerEnv({ preset }),
    stderr: "pipe"
  });
  const client = new Client({ name: "kairo-adr088-change-write-deep", version: "0.1.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await closeWithTimeout("client.close", () => client.close());
    await closeWithTimeout("transport.close", () => transport.close());
  }
}

const hasDegradedReason = (payload, matcher) => {
  const reasons = payload?.degradedReasons;
  if (!Array.isArray(reasons)) return false;
  return reasons.some((entry) => {
    const type = entry?.type;
    return typeof type === "string" && matcher(type, entry);
  });
};

const scenarioChangeGuidanceClosure = async ({ client, root }) => {
  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 1;\n", "utf-8");
  const request = "Increase the exported value constant from 1 to 2.";
  const sessionId = "adr088_change_guided";

  const plan = await callToolJson(client, "task", {
    request,
    mode: "plan_change",
    budget: "balanced",
    sessionId,
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

  const calls = assertCompactGuidance(plan.payload, { requireAtLeastOne: true });
  const applyCall = findTaskCall(
    calls,
    (args) => args?.mode === "apply_change" && typeof args?.draftId === "string" && typeof args?.applyToken === "string"
  );
  if (!applyCall) {
    throw new Error(`Expected guidance.nextCalls to include task(apply_change). payload=${JSON.stringify(plan.payload ?? null)}`);
  }

  if ("edits" in applyCall.args || "targetFiles" in applyCall.args) {
    throw new Error(`Expected apply_change guidance to be minimal (no edits/targetFiles). args=${JSON.stringify(applyCall.args)}`);
  }

  const apply = await callToolJson(client, "task", applyCall.args);
  if (apply.payload?.ok !== true || apply.payload?.status !== "success") {
    throw new Error(`Expected apply_change success from guidance call. payload=${JSON.stringify(apply.payload ?? null)}`);
  }

  const updated = fs.readFileSync(path.join(root, "src", "value.ts"), "utf-8");
  if (!updated.includes("export const value = 2;")) {
    throw new Error(`Expected src/value.ts to be updated. content=${JSON.stringify(updated)}`);
  }

  return { ok: true };
};

const scenarioChangeSessionMismatchTolerant = async ({ client, root }) => {
  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 1;\n", "utf-8");
  const request = "Increase exported value from 1 to 3.";
  const planSessionId = "adr088_change_session_a";
  const applySessionId = "adr088_change_session_b";

  const plan = await callToolJson(client, "task", {
    request,
    mode: "plan_change",
    budget: "balanced",
    sessionId: planSessionId,
    targetFiles: ["src/value.ts"],
    edits: [
      {
        filePath: "src/value.ts",
        targetString: "export const value = 1;\n",
        replacementString: "export const value = 3;\n"
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
    request: "Apply my previously planned change.",
    mode: "apply_change",
    budget: "balanced",
    sessionId: applySessionId,
    draftId,
    applyToken,
    output: { format: "summary" }
  });
  if (apply.payload?.ok !== true || apply.payload?.status !== "success") {
    throw new Error(`Expected apply_change to succeed even if sessionId mismatches. payload=${JSON.stringify(apply.payload ?? null)}`);
  }

  const updated = fs.readFileSync(path.join(root, "src", "value.ts"), "utf-8");
  if (!updated.includes("export const value = 3;")) {
    throw new Error(`Expected src/value.ts to be updated. content=${JSON.stringify(updated)}`);
  }

  return { ok: true };
};

const scenarioChangeFileVersionMismatchBlocks = async ({ client, root }) => {
  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 1;\n", "utf-8");
  const request = "Increase exported value from 1 to 4.";
  const sessionId = "adr088_change_version_mismatch";

  const plan = await callToolJson(client, "task", {
    request,
    mode: "plan_change",
    budget: "balanced",
    sessionId,
    targetFiles: ["src/value.ts"],
    edits: [
      {
        filePath: "src/value.ts",
        targetString: "export const value = 1;\n",
        replacementString: "export const value = 4;\n"
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

  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 999;\n", "utf-8");

  const apply = await callToolJson(client, "task", {
    request: "Apply the planned change.",
    mode: "apply_change",
    budget: "balanced",
    sessionId,
    draftId,
    applyToken,
    output: { format: "summary" }
  });

  const blocked =
    apply.payload?.ok === true &&
    (apply.payload?.status === "blocked" || apply.payload?.status === "partial_success") &&
    apply.payload?.status === "blocked";
  if (!blocked) {
    throw new Error(`Expected apply_change to be blocked on file version mismatch. payload=${JSON.stringify(apply.payload ?? null)}`);
  }

  const current = fs.readFileSync(path.join(root, "src", "value.ts"), "utf-8");
  if (!current.includes("export const value = 999;")) {
    throw new Error(`Expected src/value.ts to remain on external change. content=${JSON.stringify(current)}`);
  }

  return { ok: true };
};

const scenarioChangeInvalidTokenBlocked = async ({ client, root }) => {
  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 1;\n", "utf-8");
  const request = "Increase exported value from 1 to 5.";
  const sessionId = "adr088_change_invalid_token";

  const plan = await callToolJson(client, "task", {
    request,
    mode: "plan_change",
    budget: "balanced",
    sessionId,
    targetFiles: ["src/value.ts"],
    edits: [
      {
        filePath: "src/value.ts",
        targetString: "export const value = 1;\n",
        replacementString: "export const value = 5;\n"
      }
    ],
    output: { format: "summary" }
  });
  if (plan.payload?.ok !== true || plan.payload?.status !== "success") {
    throw new Error(`Expected plan_change success. payload=${JSON.stringify(plan.payload ?? null)}`);
  }
  const draftId = plan.payload?.draftId;
  if (typeof draftId !== "string" || draftId.length === 0) throw new Error("Missing draftId from plan_change");

  const apply = await callToolJson(client, "task", {
    request: "Apply the planned change.",
    mode: "apply_change",
    budget: "balanced",
    sessionId,
    draftId,
    applyToken: "deadbeef",
    output: { format: "summary" }
  });

  const blocked =
    apply.payload?.ok === true &&
    (apply.payload?.status === "blocked" || apply.payload?.status === "partial_success") &&
    hasDegradedReason(apply.payload, (type) => type.includes("apply_token_invalid"));
  if (!blocked) {
    throw new Error(`Expected apply_change to be blocked on invalid token. payload=${JSON.stringify(apply.payload ?? null)}`);
  }

  const current = fs.readFileSync(path.join(root, "src", "value.ts"), "utf-8");
  if (!current.includes("export const value = 1;")) {
    throw new Error(`Expected src/value.ts to remain unchanged. content=${JSON.stringify(current)}`);
  }

  return { ok: true };
};

const scenarioWriteGuidanceClosure = async ({ client, root }) => {
  fs.rmSync(path.join(root, "src", "generated.ts"), { force: true });
  const request = ["Create a new file with this content:", "", "```ts", "export const generated = 123;", "```", ""].join(
    "\n"
  );
  const sessionId = "adr088_write_guided";

  const plan = await callToolJson(client, "task", {
    request,
    mode: "write",
    safety: "plan",
    budget: "balanced",
    sessionId,
    targetPath: "src/generated.ts",
    output: { format: "summary" }
  });
  if (plan.payload?.ok !== true || plan.payload?.status !== "success") {
    throw new Error(`Expected write(plan) success. payload=${JSON.stringify(plan.payload ?? null)}`);
  }
  const calls = assertCompactGuidance(plan.payload, { requireAtLeastOne: true });
  const applyCall = findTaskCall(
    calls,
    (args) =>
      args?.mode === "write" &&
      args?.safety === "apply" &&
      typeof args?.draftId === "string" &&
      typeof args?.applyToken === "string"
  );
  if (!applyCall) {
    throw new Error(`Expected guidance.nextCalls to include task(write safety=apply). payload=${JSON.stringify(plan.payload ?? null)}`);
  }
  if ("targetPath" in applyCall.args) {
    throw new Error(`Expected write(apply) guidance to be minimal (no targetPath). args=${JSON.stringify(applyCall.args)}`);
  }

  const apply = await callToolJson(client, "task", applyCall.args);
  if (apply.payload?.ok !== true || apply.payload?.status !== "success") {
    throw new Error(`Expected write(apply) success from guidance call. payload=${JSON.stringify(apply.payload ?? null)}`);
  }

  const written = fs.readFileSync(path.join(root, "src", "generated.ts"), "utf-8");
  if (!written.includes("export const generated = 123;")) {
    throw new Error(`Expected src/generated.ts to be written. content=${JSON.stringify(written)}`);
  }

  return { ok: true };
};

const scenarioWriteSessionMismatchTolerant = async ({ client, root }) => {
  fs.rmSync(path.join(root, "src", "generated2.ts"), { force: true });
  const request = ["Create src/generated2.ts with this content:", "", "```ts", "export const generated2 = 456;", "```", ""].join(
    "\n"
  );
  const planSessionId = "adr088_write_session_a";
  const applySessionId = "adr088_write_session_b";
  const targetPath = "src/generated2.ts";

  const plan = await callToolJson(client, "task", {
    request,
    mode: "write",
    safety: "plan",
    budget: "balanced",
    sessionId: planSessionId,
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
    request: "Apply my planned write.",
    mode: "write",
    safety: "apply",
    budget: "balanced",
    sessionId: applySessionId,
    draftId,
    applyToken,
    output: { format: "summary" }
  });
  if (apply.payload?.ok !== true || apply.payload?.status !== "success") {
    throw new Error(`Expected write(apply) to succeed even if sessionId mismatches. payload=${JSON.stringify(apply.payload ?? null)}`);
  }

  const written = fs.readFileSync(path.join(root, targetPath), "utf-8");
  if (!written.includes("export const generated2 = 456;")) {
    throw new Error(`Expected ${targetPath} to be written. content=${JSON.stringify(written)}`);
  }

  return { ok: true };
};

const scenarioWriteDraftTargetMismatchBlocked = async ({ client, root }) => {
  fs.rmSync(path.join(root, "src", "expected.ts"), { force: true });
  fs.rmSync(path.join(root, "src", "unexpected.ts"), { force: true });
  const request = ["Create src/expected.ts with this content:", "", "```ts", "export const expected = 1;", "```", ""].join("\n");
  const sessionId = "adr088_write_target_mismatch";
  const planTargetPath = "src/expected.ts";
  const wrongTargetPath = "src/unexpected.ts";

  const plan = await callToolJson(client, "task", {
    request,
    mode: "write",
    safety: "plan",
    budget: "balanced",
    sessionId,
    targetPath: planTargetPath,
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
    request: "Apply the draft.",
    mode: "write",
    safety: "apply",
    budget: "balanced",
    sessionId,
    draftId,
    applyToken,
    targetPath: wrongTargetPath,
    output: { format: "summary" }
  });

  const blocked =
    apply.payload?.ok === true &&
    apply.payload?.status === "blocked";
  if (!blocked) {
    throw new Error(`Expected write(apply) to be blocked on targetPath mismatch. payload=${JSON.stringify(apply.payload ?? null)}`);
  }

  if (fs.existsSync(path.join(root, wrongTargetPath))) {
    const wrongContent = fs.readFileSync(path.join(root, wrongTargetPath), "utf-8");
    throw new Error(`Expected ${wrongTargetPath} to remain untouched. content=${JSON.stringify(wrongContent)}`);
  }

  return { ok: true };
};

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

      await runScenario("change.guidance_closure", scenarioChangeGuidanceClosure);
      await runScenario("change.session_mismatch_tolerant", scenarioChangeSessionMismatchTolerant);
      await runScenario("change.file_version_mismatch_blocks", scenarioChangeFileVersionMismatchBlocks);
      await runScenario("change.invalid_token_blocked", scenarioChangeInvalidTokenBlocked);
      await runScenario("write.guidance_closure", scenarioWriteGuidanceClosure);
      await runScenario("write.session_mismatch_tolerant", scenarioWriteSessionMismatchTolerant);
      await runScenario("write.draft_target_mismatch_blocked", scenarioWriteDraftTargetMismatchBlocked);
    });
  } finally {
    const keep = process.env.KAIRO_ADR088_KEEP_TMP === "true";
    if (!keep) {
      fs.rmSync(root, { recursive: true, force: true });
    } else {
      console.log(`[ADR-088 change/write deep] Keeping temp root: ${root}`);
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
    console.log(`[ADR-088] Running change/write deep suite for preset=${preset}`);
    runs.push(await runPreset({ preset, serverPath }));
  }

  const report = {
    meta: {
      id: "adr-088-change-write-deep",
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

  const explicitReportPath = process.env.KAIRO_ADR088_CHANGE_WRITE_DEEP_REPORT_PATH;
  const defaultReportDir = path.join(process.cwd(), "benchmarks", "reports");
  const reportPath = explicitReportPath
    ? path.resolve(process.cwd(), explicitReportPath)
    : path.join(defaultReportDir, `adr-088-change-write-deep-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Wrote ADR-088 change/write deep report to ${reportPath}`);

  const failures = [];
  for (const runEntry of runs) {
    for (const scenario of runEntry.scenarios) {
      if (!scenario.ok) {
        failures.push(`[${runEntry.preset}] ${scenario.id}: ${scenario.error ?? "unknown error"}`);
      }
    }
  }
  if (failures.length > 0) {
    console.error("ADR-088 change/write deep gate failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("ADR-088 change/write deep run failed:", error);
  process.exitCode = 1;
});
