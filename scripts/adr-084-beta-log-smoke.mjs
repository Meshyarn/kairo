import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.KAIRO_MODE = process.env.KAIRO_MODE ?? "mcp";
process.env.KAIRO_PUBLIC_SURFACE = process.env.KAIRO_PUBLIC_SURFACE ?? "compact";
process.env.KAIRO_BETA_LOG_ENABLED = "true";
process.env.KAIRO_ALLOW_CWD_ROOT = "true";
process.env.KAIRO_WARMUP_ENABLED = "false";

async function main() {
  const { SmartContextServer } = await import("../dist/index.js");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-beta-log-"));
  const logDir = path.join(root, ".kairo", "logs");
  process.env.KAIRO_LOG_DIR = logDir;

  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "main.ts"), "export const main = () => 'hello';\n", "utf-8");

  const server = new SmartContextServer(root);
  await server.waitForInitialScan();

  try {
    const response = await server.handleCallTool("task", {
      request: "Summarize main",
      mode: "ask",
      budget: "lean",
      paths: ["src"]
    });
    if (response?.isError) {
      const message = response?.content?.[0]?.text ?? "Unknown error";
      throw new Error(`task failed: ${message}`);
    }
  } finally {
    await server.shutdown();
  }

  const logPath = path.join(logDir, "beta.ndjson");
  if (!fs.existsSync(logPath)) {
    throw new Error(`beta log not found at ${logPath}`);
  }
  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    throw new Error("beta log is empty");
  }
  const last = JSON.parse(lines[lines.length - 1]);
  if (last.tool !== "task") {
    throw new Error(`unexpected last tool: ${last.tool}`);
  }
  if (last.status !== "ok") {
    throw new Error(`unexpected last status: ${last.status}`);
  }
  console.log(`beta log smoke OK: ${lines.length} entries`);

  fs.rmSync(root, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
