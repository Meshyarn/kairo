import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.KAIRO_MODE = process.env.KAIRO_MODE ?? "mcp";
process.env.KAIRO_PUBLIC_SURFACE = process.env.KAIRO_PUBLIC_SURFACE ?? "compact";
process.env.KAIRO_WARMUP_ENABLED = "false";
process.env.KAIRO_ALLOW_CWD_ROOT = "true";

async function main() {
  const { SmartContextServer } = await import("../dist/index.js");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-hardening-"));
  const dataDir = path.join(root, ".kairo");
  const artifactDir = path.join(dataDir, "flow-artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });

  const artifactPayload = {
    id: "schema_test",
    type: "schema",
    createdAt: Date.now(),
    schema: {
      tool: "task",
      schemaVersion: "2026-01-12",
      description: "test",
      inputSchema: { type: "object", properties: {} },
      exportedAt: Date.now()
    }
  };
  const safePath = path.join(artifactDir, "schema_test.json");
  fs.writeFileSync(safePath, JSON.stringify(artifactPayload, null, 2), "utf-8");

  const externalPath = path.join(root, "external.json");
  fs.writeFileSync(externalPath, JSON.stringify(artifactPayload, null, 2), "utf-8");

  const server = new SmartContextServer(root);
  await server.waitForInitialScan();

  try {
    const blocked = await callManage(server, { command: "import", target: externalPath });
    if (blocked.success !== false) {
      throw new Error("expected external import to be blocked");
    }

    const allowed = await callManage(server, { command: "import", target: safePath });
    if (allowed.success !== true) {
      throw new Error("expected internal import to succeed");
    }

    const override = await callManage(server, { command: "import", target: externalPath, allowExternal: true });
    if (override.success !== true) {
      throw new Error("expected allowExternal import to succeed");
    }
  } finally {
    await server.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("hardening smoke OK");
}

async function callManage(server, args) {
  const response = await server.handleCallTool("manage", args);
  const text = response?.content?.[0]?.text ?? "";
  const payload = JSON.parse(text);
  return payload.result ?? payload;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
