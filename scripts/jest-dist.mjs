import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const defaultArgs = ["dist", "--runInBand"];
const finalArgs = args.length > 0 ? args : defaultArgs;

if (!finalArgs.includes("--runInBand")) {
  finalArgs.push("--runInBand");
}

const nodeOptions = ["--experimental-vm-modules", "--max-old-space-size=8196"];
const existingOptions = (process.env.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean);
const mergedOptions = Array.from(new Set([...existingOptions, ...nodeOptions])).join(" ");

const env = { ...process.env, NODE_OPTIONS: mergedOptions };
const jestBin = path.resolve(process.cwd(), "node_modules", "jest", "bin", "jest.js");

const child = spawn(process.execPath, [jestBin, ...finalArgs], {
  stdio: "inherit",
  env
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
