import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docsRoot = path.join(repoRoot, "docs");
const packageJsonPath = path.join(repoRoot, "package.json");

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf-8"));
const packageJson = readJson(packageJsonPath);
const scriptNames = new Set(Object.keys(packageJson.scripts ?? {}));

const allowlist = new Set([
  // Allow explicit placeholders if they appear in docs.
  "your-ci-job",
]);

const envAllowlist = new Set([
  // Allow doc-only placeholders if they appear in docs.
]);

const manageCommandAllowlist = new Set([
  // Allow legacy placeholders if needed.
]);

const taskModeAllowlist = new Set([
  // Allow legacy placeholders if needed.
]);

const taskBudgetAllowlist = new Set([
  // Allow legacy placeholders if needed.
]);

const walk = (dir, files = []) => {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
};

const docFiles = walk(docsRoot);
const scriptRegex = /npm run ([A-Za-z0-9:_-]+)/g;
const manageRegex = /manage\\s*\\(\\s*\\{[\\s\\S]*?command\\s*:\\s*["']([^"'\\s]+)["']/g;
const envRegex = /KAIRO_[A-Z0-9_]+/g;
const codeBlockRegex = /```[a-zA-Z0-9_-]*\\n([\\s\\S]*?)```/g;
const requestRegex = /\\brequest\\b\\s*[:=]/;
const modeRegex = /\\bmode\\b\\s*[:=]\\s*["']([^"'\\s]+)["']/g;
const budgetRegex = /\\bbudget\\b\\s*[:=]\\s*["']([^"'\\s]+)["']/g;
const violations = [];

const extractEnumValues = (content, name) => {
  const re = new RegExp(`name:\\\\s*\\"${name}\\"[\\\\s\\\\S]*?enum:\\\\s*\\\\[([\\\\s\\\\S]*?)\\\\]`, "m");
  const match = re.exec(content);
  if (!match) return new Set();
  return new Set(
    match[1]
      .split(/\\s*,\\s*/)
      .map((value) => value.replace(/['"\\s]/g, ""))
      .filter(Boolean)
  );
};

const toolSpecA = fs.readFileSync(path.join(repoRoot, "src/server/tools/ToolSpecRegistryPillarA.ts"), "utf-8");
const toolSpecB = fs.readFileSync(path.join(repoRoot, "src/server/tools/ToolSpecRegistryPillarB.ts"), "utf-8");
const manageCommands = extractEnumValues(toolSpecB, "manage");
const taskModes = extractEnumValues(toolSpecA, "task").size > 0
  ? extractEnumValues(toolSpecA, "task")
  : new Set(["auto", "ask", "analyze", "plan_change", "apply_change", "write", "verify"]);
const taskBudgets = new Set(["lean", "balanced", "deep"]);

const scanEnvKeys = (rootDir) => {
  const envKeys = new Set();
  const files = walk(rootDir).filter((file) => file.endsWith(".ts") || file.endsWith(".mjs") || file.endsWith(".js"));
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf-8");
    envRegex.lastIndex = 0;
    let match;
    while ((match = envRegex.exec(content)) !== null) {
      envKeys.add(match[0]);
    }
  }
  return envKeys;
};

const envKeys = new Set([
  ...scanEnvKeys(path.join(repoRoot, "src")),
  ...scanEnvKeys(path.join(repoRoot, "scripts")),
]);

for (const filePath of docFiles) {
  const content = fs.readFileSync(filePath, "utf-8");
  scriptRegex.lastIndex = 0;
  manageRegex.lastIndex = 0;
  envRegex.lastIndex = 0;
  codeBlockRegex.lastIndex = 0;
  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    const scriptName = match[1];
    if (!scriptName || allowlist.has(scriptName)) continue;
    if (!scriptNames.has(scriptName)) {
      violations.push({
        filePath: path.relative(repoRoot, filePath),
        type: "script",
        value: scriptName,
      });
    }
  }

  while ((match = manageRegex.exec(content)) !== null) {
    const command = match[1];
    if (!command || manageCommandAllowlist.has(command)) continue;
    if (!manageCommands.has(command)) {
      violations.push({
        filePath: path.relative(repoRoot, filePath),
        type: "manage_command",
        value: command,
      });
    }
  }

  let envMatch;
  while ((envMatch = envRegex.exec(content)) !== null) {
    const key = envMatch[0];
    if (!key || envAllowlist.has(key)) continue;
    if (!envKeys.has(key)) {
      violations.push({
        filePath: path.relative(repoRoot, filePath),
        type: "env",
        value: key,
      });
    }
  }

  let blockMatch;
  while ((blockMatch = codeBlockRegex.exec(content)) !== null) {
    const block = blockMatch[1];
    if (!requestRegex.test(block)) continue;

    let modeMatch;
    modeRegex.lastIndex = 0;
    while ((modeMatch = modeRegex.exec(block)) !== null) {
      const mode = modeMatch[1];
      if (!mode || taskModeAllowlist.has(mode)) continue;
      if (!taskModes.has(mode)) {
        violations.push({
          filePath: path.relative(repoRoot, filePath),
          type: "task_mode",
          value: mode,
        });
      }
    }

    let budgetMatch;
    budgetRegex.lastIndex = 0;
    while ((budgetMatch = budgetRegex.exec(block)) !== null) {
      const budget = budgetMatch[1];
      if (!budget || taskBudgetAllowlist.has(budget)) continue;
      if (!taskBudgets.has(budget)) {
        violations.push({
          filePath: path.relative(repoRoot, filePath),
          type: "task_budget",
          value: budget,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("[validate-docs] Found documentation references that do not match the codebase:");
  for (const item of violations) {
    if (item.type === "script") {
      console.error(`- ${item.filePath}: npm run ${item.value}`);
      continue;
    }
    if (item.type === "manage_command") {
      console.error(`- ${item.filePath}: manage command "${item.value}"`);
      continue;
    }
    if (item.type === "task_mode") {
      console.error(`- ${item.filePath}: task mode "${item.value}"`);
      continue;
    }
    if (item.type === "task_budget") {
      console.error(`- ${item.filePath}: task budget "${item.value}"`);
      continue;
    }
    if (item.type === "env") {
      console.error(`- ${item.filePath}: env "${item.value}"`);
      continue;
    }
    console.error(`- ${item.filePath}: ${item.value}`);
  }
  process.exit(1);
}

console.log(`[validate-docs] OK (${docFiles.length} files scanned).`);
