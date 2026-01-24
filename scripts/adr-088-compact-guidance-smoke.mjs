import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

const extractGuidanceToolCalls = (payload) => {
  const guidance = payload?.guidance ?? {};
  const toolCalls = [];
  if (Array.isArray(guidance.suggestedActions)) {
    for (const action of guidance.suggestedActions) {
      const tool = action?.toolCall?.tool;
      if (typeof tool === "string") {
        toolCalls.push({ tool, args: action?.toolCall?.args ?? {} });
      }
    }
  }
  if (Array.isArray(guidance.nextCalls)) {
    for (const call of guidance.nextCalls) {
      const tool = call?.tool;
      if (typeof tool === "string") {
        toolCalls.push({ tool, args: call?.args ?? {} });
      }
    }
  }
  return toolCalls;
};

async function run() {
  const serverPath = ensureDistServer();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr088-compact-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".kairo", "config"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".kairo", "config", "mcp.json"),
    JSON.stringify(
      {
        version: 1,
        mode: "mcp",
        preset: "mcp-lean",
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
      },
      null,
      2
    ),
    "utf-8"
  );
  fs.writeFileSync(path.join(root, "src", "sample.ts"), "export const value = 1;\n", "utf-8");

  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? "production",
    KAIRO_MODE: "mcp",
    KAIRO_PUBLIC_SURFACE: "compact",
    KAIRO_WARMUP_ENABLED: "false",
    KAIRO_HEARTBEAT: "false",
    KAIRO_ALLOW_CWD_ROOT: "true",
    KAIRO_STORAGE_MODE: process.env.KAIRO_STORAGE_MODE ?? "memory",
    KAIRO_EXPOSE_FILE_TOOLS: "false"
  };

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, "--root", root],
    env,
    stderr: "pipe"
  });
  const client = new Client({ name: "kairo-adr088-compact-guidance", version: "0.1.0" });

  try {
    await client.connect(transport);
    const payload = await callToolJson(client, "task", {
      request: "Update sample value",
      mode: "plan_change",
      budget: "lean",
      targetFiles: ["src/sample.ts"],
      edits: [{ filePath: "src/sample.ts", targetString: "export const value = 1;\n", replacementString: "export const value = 2;\n" }],
      output: { format: "summary" }
    });
    if (payload?.surface !== "compact") {
      throw new Error(`Expected compact surface, got ${payload?.surface}`);
    }
    const toolCalls = extractGuidanceToolCalls(payload);
    if (toolCalls.length === 0) {
      throw new Error("Expected guidance tool calls but none were returned.");
    }
    const invalid = toolCalls.filter((entry) => !["task", "manage"].includes(entry.tool));
    if (invalid.length > 0) {
      const tools = invalid.map((entry) => entry.tool).join(", ");
      throw new Error(`Non-compact tool calls detected: ${tools}`);
    }
    console.log("ADR-088 compact guidance OK:", JSON.stringify(toolCalls));
  } finally {
    try {
      await client.close();
    } catch {}
    try {
      await transport.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error("ADR-088 compact guidance smoke failed:", error);
  process.exitCode = 1;
});
