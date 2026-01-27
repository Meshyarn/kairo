import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

function getArg(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  const value = argv[idx + 1];
  return value ? String(value) : "";
}

function hasArg(argv, name) {
  return argv.includes(name);
}

function printHelp() {
  process.stdout.write(
    [
      "Kairo benchmark launcher (convenience wrapper)",
      "",
      "Usage:",
      "  node benchmarks/agent/launch.mjs --provider <codex|gemini> [cascade.ts args...]",
      "",
      "Examples:",
      "  node benchmarks/agent/launch.mjs --provider codex --pipeline route \\",
      "    --suite benchmarks/agent/suite.kairo5.json --mode live \\",
      "    --mini gpt-5.1-codex-mini --full gpt-5.1-codex --timeout-ms 600000 \\",
      "    --kairo-budget low --pricing benchmarks/agent/pricing.json \\",
      "    --attempts 2 --gate-files-min 5 --gate-category cli",
      "",
      "  GEMINI_API_KEY=... node benchmarks/agent/launch.mjs --provider gemini --pipeline route \\",
      "    --suite benchmarks/agent/suite.kairo5.json --mode live \\",
      "    --mini gemini-3-flash-preview --full gemini-3-pro-preview --timeout-ms 600000 \\",
      "    --kairo-budget low --pricing benchmarks/agent/pricing.json \\",
      "    --attempts 2 --gate-files-min 5 --gate-category cli",
      "",
      "Notes:",
      "- This wrapper sets KAIRO_AGENT_MODEL_CMD automatically per provider unless already set.",
      "- For Codex, you must be authenticated (e.g., run `codex login`).",
      ""
    ].join("\n")
  );
}

const argv = process.argv.slice(2);
if (hasArg(argv, "--help") || hasArg(argv, "-h")) {
  printHelp();
  process.exit(0);
}

const provider = getArg(argv, "--provider") || process.env.KAIRO_BENCH_PROVIDER || "codex";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const env = { ...process.env };
if (!env.KAIRO_AGENT_MODEL_CMD) {
  if (provider === "codex") {
    env.KAIRO_AGENT_MODEL_CMD = "node scripts/run-codex-cli-agent.mjs";
  } else if (provider === "gemini") {
    env.KAIRO_AGENT_MODEL_CMD = "node scripts/run-gemini-agent.mjs";
  } else {
    process.stderr.write(`Unsupported provider: ${provider}\n`);
    process.exit(2);
  }
}

const cascadeArgs = ["--import", "tsx", "benchmarks/agent/cascade.ts", ...argv];
const result = spawnSync("node", cascadeArgs, { cwd: repoRoot, env, stdio: "inherit" });
process.exit(result.status ?? 1);

