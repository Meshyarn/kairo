import * as fs from "fs";
import * as path from "path";
import { PathManager } from "../src/utils/PathManager.js";

const rootPath = process.cwd();
PathManager.setRoot(rootPath);

const legacyPath = path.join(rootPath, ".mcp-config.json");
const targetDir = PathManager.getConfigDir();
const targetPath = path.join(targetDir, "mcp-config.json");

if (!fs.existsSync(legacyPath)) {
  process.stderr.write("[migrate-mcp-config] No legacy .mcp-config.json found. Nothing to do.\n");
  process.exit(0);
}

if (fs.existsSync(targetPath)) {
  process.stderr.write(`[migrate-mcp-config] Target config already exists at ${targetPath}. Skipping.\n`);
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(legacyPath, targetPath);
process.stderr.write(`[migrate-mcp-config] Migrated config to ${targetPath}.\n`);
