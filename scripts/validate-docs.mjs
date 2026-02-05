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
const violations = [];

for (const filePath of docFiles) {
  const content = fs.readFileSync(filePath, "utf-8");
  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    const scriptName = match[1];
    if (!scriptName || allowlist.has(scriptName)) continue;
    if (!scriptNames.has(scriptName)) {
      violations.push({
        filePath: path.relative(repoRoot, filePath),
        scriptName,
      });
    }
  }
}

if (violations.length > 0) {
  console.error("[validate-docs] Found npm scripts referenced in docs that are not in package.json:");
  for (const item of violations) {
    console.error(`- ${item.filePath}: npm run ${item.scriptName}`);
  }
  process.exit(1);
}

console.log(`[validate-docs] OK (${docFiles.length} files scanned).`);

