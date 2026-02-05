import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const archiveDir = path.join(repoRoot, ".archive");
const docsAdrDir = path.join(repoRoot, "docs", "adr");
const outputMarkdown = path.join(repoRoot, "docs", "reference", "adr-dashboard.md");
const outputJson = path.join(repoRoot, "docs", "reference", "adr-dashboard.json");

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

const readHead = (filePath, lines = 40) => {
  const content = fs.readFileSync(filePath, "utf-8");
  return content.split(/\r?\n/).slice(0, lines);
};

const parseHeader = (filePath) => {
  const head = readHead(filePath);
  let title = "";
  let status = "";
  let date = "";
  for (const line of head) {
    if (!title) {
      const match = /^#\s+(.+)/.exec(line.trim());
      if (match) title = match[1].trim();
    }
    if (!status) {
      const match = /\*\*Status:\*\*\s*([^\n]+)/i.exec(line);
      if (match) status = match[1].trim();
    }
    if (!status) {
      const match = /^Status:\s*([^\n]+)/i.exec(line.trim());
      if (match) status = match[1].trim();
    }
    if (!date) {
      const match = /\*\*Date:\*\*\s*([^\n]+)/i.exec(line);
      if (match) date = match[1].trim();
    }
    if (!date) {
      const match = /^Date:\s*([^\n]+)/i.exec(line.trim());
      if (match) date = match[1].trim();
    }
  }
  return { title, status: status || "unknown", date: date || "unknown" };
};

const listArchiveAdrs = () => {
  if (!fs.existsSync(archiveDir)) return [];
  return fs.readdirSync(archiveDir)
    .filter((file) => /^ADR-\d{3}.*\.md$/.test(file))
    .map((file) => path.join(archiveDir, file));
};

const listCuratedAdrs = () => {
  if (!fs.existsSync(docsAdrDir)) return new Map();
  const map = new Map();
  for (const file of fs.readdirSync(docsAdrDir)) {
    if (!/^ADR-\d{3}.*\.md$/.test(file)) continue;
    const idMatch = /^ADR-\d{3}/.exec(file);
    if (!idMatch) continue;
    map.set(idMatch[0], file);
  }
  return map;
};

const archiveFiles = listArchiveAdrs();
const curatedMap = listCuratedAdrs();

const entries = archiveFiles.map((filePath) => {
  const fileName = path.basename(filePath);
  const idMatch = /^ADR-\d{3}/.exec(fileName);
  const id = idMatch ? idMatch[0] : fileName;
  const header = parseHeader(filePath);
  const curatedFile = curatedMap.get(id);
  return {
    id,
    title: header.title,
    status: header.status,
    date: header.date,
    archiveFile: path.relative(repoRoot, filePath),
    curatedFile: curatedFile ? path.join("docs", "adr", curatedFile) : null
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const byStatus = entries.reduce((acc, entry) => {
  acc[entry.status] = (acc[entry.status] ?? 0) + 1;
  return acc;
}, {});

const totals = {
  count: entries.length,
  curatedCount: entries.filter((entry) => entry.curatedFile).length,
  archivedOnlyCount: entries.filter((entry) => !entry.curatedFile).length,
  byStatus
};

const renderMarkdown = () => {
  const lines = [];
  lines.push("# ADR Dashboard");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total ADRs: ${totals.count}`);
  lines.push(`- Curated ADRs: ${totals.curatedCount}`);
  lines.push(`- Archived-only ADRs: ${totals.archivedOnlyCount}`);
  lines.push("");
  lines.push("### Status breakdown");
  lines.push("");
  for (const [status, count] of Object.entries(byStatus).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push("");
  lines.push("## ADR Index");
  lines.push("");
  lines.push("| ADR | Status | Date | Curated | Title |");
  lines.push("|---|---|---|---|---|");
  for (const entry of entries) {
    const archiveLink = `\`${entry.archiveFile}\``;
    const curatedLink = entry.curatedFile ? `\`${entry.curatedFile}\`` : "—";
    lines.push(`| ${archiveLink} | ${entry.status} | ${entry.date} | ${curatedLink} | ${entry.title || "—"} |`);
  }
  lines.push("");
  return lines.join("\n");
};

const markdown = renderMarkdown();
const json = JSON.stringify({ generatedAt: new Date().toISOString(), totals, entries }, null, 2);

const checkFile = (filePath, expected) => {
  if (!fs.existsSync(filePath)) return false;
  const current = fs.readFileSync(filePath, "utf-8");
  return current === expected;
};

if (checkOnly) {
  const mdOk = checkFile(outputMarkdown, markdown);
  const jsonOk = checkFile(outputJson, json);
  if (!mdOk || !jsonOk) {
    console.error("[adr-dashboard] Output files are out of date. Run: npm run generate:adr-dashboard");
    process.exit(1);
  }
  console.log("[adr-dashboard] OK.");
  process.exit(0);
}

fs.mkdirSync(path.dirname(outputMarkdown), { recursive: true });
fs.writeFileSync(outputMarkdown, markdown, "utf-8");
fs.writeFileSync(outputJson, json, "utf-8");
console.log(`[adr-dashboard] Wrote ${path.relative(repoRoot, outputMarkdown)} and ${path.relative(repoRoot, outputJson)}.`);
