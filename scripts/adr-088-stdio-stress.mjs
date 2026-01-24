import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { performance } from "node:perf_hooks";

import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const ensureDistServer = () => {
  const distPath = path.resolve(process.cwd(), "dist", "index.js");
  if (!fs.existsSync(distPath)) {
    throw new Error(`dist server not found: ${distPath}. Run \`npm run build\` first.`);
  }
  return distPath;
};

const sleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const parseNumberEnv = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const createFixtureRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr088-stdio-stress-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# ADR-088 stdio stress fixture\n", "utf-8");
  fs.writeFileSync(path.join(root, "src", "value.ts"), "export const value = 1;\n", "utf-8");
  return root;
};

const buildServerEnv = () => ({
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "production",
  KAIRO_MODE: "mcp",
  KAIRO_PUBLIC_SURFACE: "compact",
  KAIRO_WARMUP_ENABLED: process.env.KAIRO_WARMUP_ENABLED ?? "false",
  KAIRO_HEARTBEAT: "false",
  KAIRO_ALLOW_CWD_ROOT: "true",
  KAIRO_ALLOW_STDOUT_LOGS: "false",
  KAIRO_EXPOSE_FILE_TOOLS: "false"
});

const writeChunk = async (stream, chunk) => {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
};

const sendChunked = async (stream, message, { chunkMin, chunkMax, random, interChunkDelayMs }) => {
  const payload = serializeMessage(message);
  const min = Math.max(1, Math.floor(chunkMin));
  const max = Math.max(min, Math.floor(chunkMax));

  let offset = 0;
  while (offset < payload.length) {
    const size = Math.min(payload.length - offset, min + Math.floor(random() * (max - min + 1)));
    await writeChunk(stream, Buffer.from(payload.slice(offset, offset + size)));
    offset += size;
    if (interChunkDelayMs > 0) {
      await sleep(Math.floor(random() * interChunkDelayMs));
    }
  }
};

class JsonRpcHarnessClient {
  constructor(child, { timeoutMs, stderrBuffer }) {
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.stderrBuffer = stderrBuffer;

    this.readBuffer = new ReadBuffer();
    this.pending = new Map();
    this.inbox = new Map();
    this.parseErrors = [];

    this.onData = (chunk) => {
      try {
        this.readBuffer.append(chunk);
        while (true) {
          const message = this.readBuffer.readMessage();
          if (!message) break;
          const id = message?.id;
          if (id === undefined || id === null) continue;
          const key = String(id);
          const waiter = this.pending.get(key);
          if (waiter) {
            this.pending.delete(key);
            waiter.resolve(message);
          } else {
            this.inbox.set(key, message);
          }
        }
      } catch (error) {
        this.parseErrors.push(error instanceof Error ? error.message : String(error));
      }
    };

    this.onClose = (code, signal) => {
      for (const waiter of this.pending.values()) {
        waiter.reject(new Error(`Server closed. code=${code} signal=${signal}`));
      }
      this.pending.clear();
    };

    child.stdout.on("data", this.onData);
    child.on("close", this.onClose);
  }

  waitForResponse(id, label) {
    const key = String(id);
    const existing = this.inbox.get(key);
    if (existing) {
      this.inbox.delete(key);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Timeout waiting for ${label}. stderr=${this.stderrBuffer.join("")}`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(key, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  dispose() {
    this.child.stdout.off("data", this.onData);
    this.child.off("close", this.onClose);
    for (const waiter of this.pending.values()) {
      waiter.reject(new Error("Disposed"));
    }
    this.pending.clear();
    this.inbox.clear();
  }
}

const shutdownChild = async (child) => {
  const waitForClose = () => once(child, "close");
  const delay = async (ms) => {
    await sleep(ms);
  };

  try {
    child.stdin.end();
  } catch {
    // ignore
  }
  await Promise.race([waitForClose(), delay(2000)]);

  if (child.exitCode == null) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    await Promise.race([waitForClose(), delay(2000)]);
  }
  if (child.exitCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    await Promise.race([waitForClose(), delay(2000)]);
  }
};

const requireToolJson = (message, label) => {
  if (message?.error) {
    throw new Error(`${label} failed: ${message.error.message ?? "unknown"}`);
  }
  const text = message?.result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) {
    throw new Error(`${label} missing tool content text`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    throw new Error(`${label} invalid JSON payload: ${error?.message ?? error}\n${preview}`);
  }
};

const buildToolCalls = () => [
  {
    label: "manage.status",
    params: { name: "manage", arguments: { command: "status", detail: "summary", suppressLogs: true } }
  },
  {
    label: "manage.schema",
    params: { name: "manage", arguments: { command: "schema", tool: "task", detail: "summary" } }
  }
];

async function runIteration({ serverPath, root, iteration, config, random }) {
  const stderrBuffer = [];
  const child = spawn(process.execPath, [serverPath, "--root", root], {
    env: buildServerEnv(),
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stderr.on("data", (chunk) => stderrBuffer.push(chunk.toString()));

  const startedAt = Date.now();
  const startedPerf = performance.now();
  const harness = new JsonRpcHarnessClient(child, {
    timeoutMs: config.responseTimeoutMs,
    stderrBuffer
  });

  let ok = true;
  const events = [];
  const record = (entry) => events.push({ ts: Date.now(), ...entry });

  try {
    await once(child, "spawn");

    const initId = 1;
    record({ type: "send", label: "initialize", id: initId });
    await sendChunked(
      child.stdin,
      {
        jsonrpc: "2.0",
        id: initId,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "kairo-adr088-stdio-stress", version: "0.1.0" }
        }
      },
      config.framing
    );
    const initResponse = await harness.waitForResponse(initId, "initialize");
    if (initResponse?.error) {
      throw new Error(`initialize failed: ${initResponse.error.message ?? "unknown"}`);
    }

    record({ type: "send", label: "notifications/initialized" });
    await sendChunked(
      child.stdin,
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      config.framing
    );

    const toolsId = 2;
    record({ type: "send", label: "tools/list", id: toolsId });
    await sendChunked(child.stdin, { jsonrpc: "2.0", id: toolsId, method: "tools/list", params: {} }, config.framing);
    const toolsResponse = await harness.waitForResponse(toolsId, "tools/list");
    if (toolsResponse?.error) {
      throw new Error(`tools/list failed: ${toolsResponse.error.message ?? "unknown"}`);
    }
    const toolNames = (toolsResponse.result?.tools ?? []).map((tool) => tool?.name).filter(Boolean).sort();
    if (toolNames.join(",") !== "manage,task") {
      throw new Error(`Expected compact tool surface [manage,task], got: ${toolNames.join(", ")}`);
    }

    const toolCalls = buildToolCalls();
    const inflight = [];
    let nextId = 100;
    let sent = 0;
    let received = 0;

    while (sent < config.requestCount || inflight.length > 0) {
      while (sent < config.requestCount && inflight.length < config.maxInflight) {
        const call = toolCalls[sent % toolCalls.length];
        const id = nextId++;
        inflight.push({ id, label: call.label });
        sent += 1;
        record({ type: "send", label: call.label, id });
        await sendChunked(
          child.stdin,
          { jsonrpc: "2.0", id, method: "tools/call", params: call.params },
          config.framing
        );
      }

      const pending = inflight[0];
      if (!pending) continue;
      const response = await harness.waitForResponse(pending.id, pending.label);
      inflight.shift();
      received += 1;
      record({ type: "recv", label: pending.label, id: pending.id });
      requireToolJson(response, pending.label);
    }

    if (received !== sent) {
      throw new Error(`Expected to receive all responses. sent=${sent} received=${received}`);
    }

    if (harness.parseErrors.length > 0) {
      throw new Error(`Stdout framing parse errors detected: ${harness.parseErrors.join("; ")}`);
    }
  } catch (error) {
    ok = false;
    record({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      stderrTail: stderrBuffer.join("").slice(-2000)
    });
  } finally {
    await shutdownChild(child);
    harness.dispose();
  }

  return {
    iteration,
    ok,
    startedAt,
    finishedAt: Date.now(),
    wallTimeMs: performance.now() - startedPerf,
    events,
    stderrTail: stderrBuffer.join("").slice(-2000)
  };
}

async function run() {
  const serverPath = ensureDistServer();
  const seed = Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_STRESS_SEED, Date.now()));
  const random = mulberry32(seed);

  const config = {
    iterations: Math.max(1, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_STRESS_ITERATIONS, 3))),
    requestCount: Math.max(1, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_STRESS_REQUESTS, 60))),
    maxInflight: Math.max(1, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_STRESS_MAX_INFLIGHT, 6))),
    responseTimeoutMs: Math.max(1000, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_STRESS_RESPONSE_TIMEOUT_MS, 10_000))),
    framing: {
      chunkMin: Math.max(1, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_STRESS_CHUNK_MIN, 1))),
      chunkMax: Math.max(1, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_STRESS_CHUNK_MAX, 23))),
      interChunkDelayMs: Math.max(0, Math.floor(parseNumberEnv(process.env.KAIRO_ADR088_STRESS_INTERCHUNK_DELAY_MS, 0))),
      random
    }
  };

  const root = createFixtureRoot();
  const runs = [];
  try {
    for (let i = 0; i < config.iterations; i += 1) {
      console.log(`[ADR-088 stdio-stress] Iteration ${i + 1}/${config.iterations}`);
      runs.push(await runIteration({ serverPath, root, iteration: i + 1, config, random }));
    }
  } finally {
    const keep = process.env.KAIRO_ADR088_KEEP_TMP === "true";
    if (!keep) {
      fs.rmSync(root, { recursive: true, force: true });
    } else {
      console.log(`[ADR-088] Keeping temp root: ${root}`);
    }
  }

  const failed = runs.filter((entry) => !entry.ok);
  const report = {
    meta: {
      id: "adr-088-stdio-stress",
      createdAt: Date.now(),
      seed,
      config: {
        iterations: config.iterations,
        requestCount: config.requestCount,
        maxInflight: config.maxInflight,
        responseTimeoutMs: config.responseTimeoutMs,
        chunkMin: config.framing.chunkMin,
        chunkMax: config.framing.chunkMax,
        interChunkDelayMs: config.framing.interChunkDelayMs
      },
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "production",
        KAIRO_MODE: "mcp",
        KAIRO_PUBLIC_SURFACE: "compact",
        KAIRO_ALLOW_STDOUT_LOGS: "false"
      }
    },
    summary: {
      iterations: runs.length,
      passed: runs.length - failed.length,
      failed: failed.length
    },
    runs
  };

  const explicitReportPath = process.env.KAIRO_ADR088_STRESS_REPORT_PATH;
  const defaultReportDir = path.join(process.cwd(), "benchmarks", "reports");
  const reportPath = explicitReportPath
    ? path.resolve(process.cwd(), explicitReportPath)
    : path.join(defaultReportDir, `adr-088-stdio-stress-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Wrote ADR-088 stdio stress report to ${reportPath}`);

  if (failed.length > 0) {
    console.error("ADR-088 stdio stress gate failed:");
    for (const entry of failed) {
      console.error(`- iteration ${entry.iteration} failed (wallTimeMs=${Math.round(entry.wallTimeMs)})`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("ADR-088 stdio stress run failed:", error);
  process.exitCode = 1;
});
