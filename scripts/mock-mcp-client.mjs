import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveArg = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
};

const ensureDist = () => {
  const distPath = path.resolve(process.cwd(), "dist", "index.js");
  if (!fs.existsSync(distPath)) {
    throw new Error(`dist server not found: ${distPath}. Run \`npm run build\` first.`);
  }
  return distPath;
};

const createTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-mcp-mock-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# MCP mock\n", "utf-8");
  fs.writeFileSync(path.join(root, "src", "main.ts"), 'export const marker = "NEEDLE0";\n', "utf-8");
  return root;
};

const parseToolJson = (toolResult, label) => {
  const text = toolResult?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`Missing MCP tool response text for ${label}`);
  }
  try {
    return JSON.parse(text);
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
  const result = await client.callTool({ name, arguments: args });
  return unwrapToolResult(parseToolJson(result, name));
};

const waitForNativeIndex = async (client, { timeoutMs = 30_000, intervalMs = 250 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;
  while (Date.now() < deadline) {
    lastStatus = await callToolJson(client, "manage", { command: "status", detail: "summary", suppressLogs: true });
    const docCount = lastStatus?.nativeSearch?.stats?.docCount ?? 0;
    const reindexInProgress = Boolean(lastStatus?.activity?.reindexInProgress);
    if (!reindexInProgress && docCount > 0) {
      return lastStatus;
    }
    await sleep(intervalMs);
  }
  const native = lastStatus?.nativeSearch ?? null;
  const activity = lastStatus?.activity ?? null;
  const lastReindex = activity?.lastReindex ?? null;
  throw new Error(
    `Timed out waiting for native search index.\n` +
      `nativeSearch=${JSON.stringify(native)}\n` +
      `reindexInProgress=${Boolean(activity?.reindexInProgress)} lastReindex=${JSON.stringify(lastReindex)}`
  );
};

async function main() {
  const serverPath = resolveArg("--server") ?? ensureDist();
  const root = resolveArg("--root") ?? createTempRoot();

  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? "production",
    KAIRO_MODE: "mcp",
    KAIRO_PUBLIC_SURFACE: process.env.KAIRO_PUBLIC_SURFACE ?? "compact",
    KAIRO_WARMUP_ENABLED: "false",
    KAIRO_METRICS_MODE: process.env.KAIRO_METRICS_MODE ?? "basic",
    KAIRO_BASELINE_ENABLED: process.env.KAIRO_BASELINE_ENABLED ?? "on",
    KAIRO_EXPOSE_FILE_TOOLS: process.env.KAIRO_EXPOSE_FILE_TOOLS ?? "true",
    KAIRO_ALLOW_CWD_ROOT: "true",
    // Ensure we don't accidentally use the in-process test stub loader.
    KAIRO_TEST_USE_NATIVE_CORE: process.env.KAIRO_TEST_USE_NATIVE_CORE ?? "true",
    KAIRO_STORAGE_MODE: process.env.KAIRO_STORAGE_MODE ?? "memory"
  };

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, "--root", root],
    env,
    stderr: "pipe"
  });
  const client = new Client({ name: "kairo-mcp-mock-client", version: "0.1.0" });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    console.log("tools:", tools.tools.map((t) => t.name).sort().join(", "));

    const schema = await callToolJson(client, "manage", { command: "schema", tool: "task", detail: "summary" });
    console.log("manage schema keys:", Object.keys(schema ?? {}).sort().join(", "));

    await callToolJson(client, "manage", { command: "reindex" });
    const status = await waitForNativeIndex(client);
    console.log("nativeSearch docCount:", status?.nativeSearch?.stats?.docCount ?? 0);

    const fileSearchResults = await callToolJson(client, "file_search", { query: "NEEDLE0", basePath: root, maxResults: 5 });
    if (!Array.isArray(fileSearchResults) || fileSearchResults.length === 0) {
      throw new Error(`Expected file_search results, got ${typeof fileSearchResults}`);
    }
    const scoreTypes = Array.from(new Set(fileSearchResults.map((r) => r?.scoreDetails?.type).filter(Boolean)));
    if (!scoreTypes.includes("native")) {
      throw new Error(`Expected native file_search results, got scoreDetails.type: ${scoreTypes.join(", ") || "(none)"}`);
    }
    console.log("file_search ok:", { top: fileSearchResults[0]?.filePath, scoreType: fileSearchResults[0]?.scoreDetails?.type });

    const fileRead = await callToolJson(client, "file_read", { filePath: "src/main.ts", full: true });
    const readText = fileRead?.content ?? fileRead?.text ?? fileRead?.raw;
    if (typeof readText !== "string" || !readText.includes("NEEDLE0")) {
      throw new Error("Expected file_read to include NEEDLE0 in content.");
    }
    console.log("file_read ok:", { bytes: Buffer.byteLength(readText, "utf-8") });
  } finally {
    try {
      await client.close();
    } catch {}
    try {
      await transport.close();
    } catch {}
    if (!resolveArg("--root")) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
