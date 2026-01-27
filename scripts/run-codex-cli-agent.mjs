import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_MODEL = process.env.KAIRO_BENCH_MODEL || process.env.CODEX_MODEL || "gpt-5-codex";
const CODEX_PROFILE = process.env.CODEX_PROFILE;
const CODEX_REASONING_EFFORT = process.env.CODEX_REASONING_EFFORT || "medium";
const CODEX_TOOL_MODE = process.env.CODEX_TOOL_MODE || process.env.KAIRO_BENCH_TOOL_MODE;
const CODEX_TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS || "120000");
const WORKSPACE = process.env.KAIRO_BENCH_WORKSPACE || process.cwd();
const HOST_CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const DEFAULT_BENCH_HOME = path.join(process.cwd(), ".codex-bench");
const BENCH_HOME = process.env.KAIRO_BENCH_HOME || process.env.CODEX_HOME || DEFAULT_BENCH_HOME;
const BENCH_LOG_DIR = process.env.KAIRO_BENCH_LOG_DIR;
const KAIRO_ENV_RAW = process.env.KAIRO_BENCH_KAIRO_ENV;
const BENCH_CODEX_HOME = path.join(BENCH_HOME, ".codex");

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function tryParseJsonLines(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore non-JSON lines
    }
  }
  return events;
}

function parseKairoEnvOverrides(input) {
  if (!input) return {};
  const trimmed = String(input).trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const entries = {};
      for (const [key, value] of Object.entries(parsed)) {
        entries[key] = String(value);
      }
      return entries;
    }
  } catch {
    // fall through
  }
  const result = {};
  for (const part of trimmed.split(",")) {
    const pair = part.trim();
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function tailText(text, max = 2000) {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

function killTree(child) {
  try {
    if (child?.pid) {
      process.kill(-child.pid, "SIGKILL");
      return;
    }
  } catch {
    // fall through
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
}

function writeDebugLog(payload) {
  if (!BENCH_LOG_DIR) return;
  fs.mkdirSync(BENCH_LOG_DIR, { recursive: true });
  const logPath = path.join(BENCH_LOG_DIR, `codex-exec-${Date.now()}-${process.pid}.log`);
  fs.writeFileSync(logPath, payload);
}

async function main() {
  const prompt = await readStdin();
  const benchTmp = path.join(BENCH_HOME, "tmp");
  const benchZshenv = path.join(BENCH_HOME, ".zshenv");
  fs.mkdirSync(BENCH_CODEX_HOME, { recursive: true });
  fs.mkdirSync(benchTmp, { recursive: true });
  if (!fs.existsSync(benchZshenv)) {
    fs.writeFileSync(benchZshenv, "");
  }
  for (const filename of ["auth.json", "config.toml", "models_cache.json", "version.json"]) {
    const src = path.join(HOST_CODEX_HOME, filename);
    const dest = path.join(BENCH_CODEX_HOME, filename);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-codex-"));
  const schemaPath = path.join(tmpRoot, "schema.json");
  const outputPath = path.join(tmpRoot, "last-message.json");

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      patch_unified_diff: { type: ["string", "null"] },
      final_answer: { type: "string" },
      notes: { type: "array", items: { type: "string" } }
    },
    required: ["patch_unified_diff", "final_answer", "notes"]
  };
  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));

  const args = [
    "exec",
    "--cd",
    WORKSPACE,
    "--add-dir",
    BENCH_HOME,
    "--model",
    CODEX_MODEL,
    "-c",
    `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
    "--full-auto",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "--json",
    "-"
  ];

  const kairoEnvOverrides = parseKairoEnvOverrides(KAIRO_ENV_RAW);
  for (const [key, value] of Object.entries(kairoEnvOverrides)) {
    args.push("-c", `mcp_servers.kairo.env.${key}=${JSON.stringify(String(value))}`);
  }

  if (CODEX_TOOL_MODE === "baseline") {
    args.push("-c", "mcp_servers.kairo.enabled=false");
    args.push("--enable", "shell_tool");
  }

  if (CODEX_TOOL_MODE === "kairo") {
    args.push("-c", "mcp_servers.kairo.enabled=true");
    args.push("--enable", "shell_tool");
  }

  if (CODEX_PROFILE) {
    args.push("--profile", CODEX_PROFILE);
  }

  const child = spawn(CODEX_BIN, args, {
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: BENCH_HOME,
      ZDOTDIR: BENCH_HOME,
      TMPDIR: benchTmp,
      TMP: benchTmp,
      TEMP: benchTmp
    }
  });
  const stdoutChunks = [];
  const stderrChunks = [];

  const timer = setTimeout(() => {
    const debugPayload = [
      `timeoutMs=${CODEX_TIMEOUT_MS}`,
      `model=${CODEX_MODEL}`,
      `tool_mode=${CODEX_TOOL_MODE || "default"}`,
      `workspace=${WORKSPACE}`,
      `bench_home=${BENCH_HOME}`,
      `bench_codex_home=${BENCH_CODEX_HOME}`,
      `prompt_length=${prompt.length}`
    ].join("\n");
    writeDebugLog(`${debugPayload}\nerror=codex exec timed out`);
    killTree(child);
    console.error(`codex exec timed out after ${CODEX_TIMEOUT_MS}ms`);
    process.exit(1);
  }, CODEX_TIMEOUT_MS);

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });

  child.stdin.write(prompt);
  child.stdin.end();

  const exitCode = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
  clearTimeout(timer);

  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");

  if (exitCode !== 0) {
    const stderrText = stderr.trim();
    const stdoutText = stdout.trim();
    const detail = stderrText || tailText(stdoutText);
    const debugPayload = [
      `exitCode=${exitCode}`,
      `model=${CODEX_MODEL}`,
      `tool_mode=${CODEX_TOOL_MODE || "default"}`,
      `workspace=${WORKSPACE}`,
      `bench_home=${BENCH_HOME}`,
      `bench_codex_home=${BENCH_CODEX_HOME}`,
      `prompt_length=${prompt.length}`,
      `stderr=${stderrText}`,
      `stdout_tail=${tailText(stdoutText, 4000)}`
    ].join("\n");
    writeDebugLog(debugPayload);
    console.error(`codex exec failed (${exitCode}): ${detail}`);
    process.exit(1);
  }

  if (!fs.existsSync(outputPath)) {
    console.error("codex exec did not produce output file.");
    process.exit(1);
  }

  const outputText = fs.readFileSync(outputPath, "utf8").trim();
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (err) {
    console.error(`Failed to parse codex JSON output: ${err.message}`);
    process.exit(1);
  }

  const events = tryParseJsonLines(stdout);
  let usage = {};
  for (const event of events) {
    if (event?.usage) {
      usage = event.usage;
    }
    if (event?.token_usage) {
      usage = event.token_usage;
    }
  }

  parsed.usage = parsed.usage ?? usage ?? {};
  process.stdout.write(JSON.stringify(parsed));
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
