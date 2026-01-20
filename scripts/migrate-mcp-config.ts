import * as fs from "fs";
import * as path from "path";
import { PathManager } from "../src/utils/PathManager.js";

const rootPath = process.cwd();
PathManager.setRoot(rootPath);

const legacyRootPath = path.join(rootPath, ".mcp-config.json");
const targetDir = PathManager.getConfigDir();
const legacyConfigDirPath = path.join(targetDir, "mcp-config.json");
const targetPath = path.join(targetDir, ".mcp-config.json");

const isPlainObject = (value: unknown): value is Record<string, any> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const readJsonFile = (filePath: string): Record<string, any> | undefined => {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch (error) {
    process.stderr.write(`[migrate-mcp-config] Failed to parse ${filePath}: ${String(error)}\n`);
    return undefined;
  }
};

const deepMerge = (target: any, patch: any): any => {
  if (patch === undefined || patch === null) return target;
  if (!isPlainObject(patch)) return patch;
  const output: Record<string, any> = { ...(isPlainObject(target) ? target : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value)) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
};

const legacyRoot = fs.existsSync(legacyRootPath) ? readJsonFile(legacyRootPath) : undefined;
const legacyConfigDir = fs.existsSync(legacyConfigDirPath) ? readJsonFile(legacyConfigDirPath) : undefined;

const legacyRootRepoConfig = isPlainObject(legacyRoot?.multiRepo)
  ? legacyRoot.multiRepo
  : legacyRoot;

const repoConfig = (legacyConfigDir?.repositories && typeof legacyConfigDir.repositories === "object")
  ? legacyConfigDir
  : (legacyRootRepoConfig?.repositories && typeof legacyRootRepoConfig.repositories === "object" ? legacyRootRepoConfig : undefined);

const policyConfig = (() => {
  const out: Record<string, any> = {};
  for (const source of [legacyRoot, legacyConfigDir]) {
    if (!source) continue;
    for (const key of ["validation", "integrityGuardrails", "architecturalSafety", "overrides"]) {
      if (key in source) out[key] = source[key];
    }
  }
  return out;
})();

const mergedConfig = deepMerge(repoConfig ?? {}, policyConfig);

if (!legacyRoot && !legacyConfigDir) {
  process.stderr.write("[migrate-mcp-config] No legacy MCP config found. Nothing to do.\n");
  process.exit(0);
}

if (fs.existsSync(targetPath)) {
  process.stderr.write(`[migrate-mcp-config] Target config already exists at ${targetPath}. Skipping.\n`);
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(targetPath, JSON.stringify(mergedConfig, null, 2), "utf-8");
process.stderr.write(`[migrate-mcp-config] Migrated config to ${targetPath}.\n`);
