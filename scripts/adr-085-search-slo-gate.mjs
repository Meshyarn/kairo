import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

process.env.KAIRO_TEST_USE_NATIVE_CORE = process.env.KAIRO_TEST_USE_NATIVE_CORE ?? "true";
process.env.KAIRO_RUST_CORE_ENABLED = process.env.KAIRO_RUST_CORE_ENABLED ?? "true";
process.env.KAIRO_WARMUP_ENABLED = process.env.KAIRO_WARMUP_ENABLED ?? "false";
process.env.KAIRO_METRICS_MODE = process.env.KAIRO_METRICS_MODE ?? "basic";
process.env.KAIRO_STORAGE_MODE = process.env.KAIRO_STORAGE_MODE ?? "memory";

const DEFAULT_CONFIG = {
  fileCount: 2000,
  needleCount: 200,
  sampleCount: 60,
  maxNativeSearchP95Ms: 50,
  maxFileSearchP95Ms: 120,
  maxHeapDeltaMb: 64,
  maxIndexSizeMb: 256
};

async function main() {
  const { PathManager } = await import("../dist/utils/PathManager.js");
  const { hashContent } = await import("../dist/utils/hash.js");
  const { NativeSearchCore } = await import("../dist/engine/search/native/NativeSearchCore.js");
  const { NativeSearchIndexer } = await import("../dist/engine/search/native/NativeSearchIndexer.js");
  const { SearchEngine } = await import("../dist/engine/Search.js");
  const { NodeFileSystem } = await import("../dist/platform/FileSystem.js");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr085-search-slo-"));
  PathManager.setRoot(root);

  const repoId = "default";
  const fileCount = parseNumberEnv(process.env.KAIRO_ADR085_FILE_COUNT, DEFAULT_CONFIG.fileCount);
  const needleCount = parseNumberEnv(process.env.KAIRO_ADR085_NEEDLE_COUNT, DEFAULT_CONFIG.needleCount);
  const sampleCount = parseNumberEnv(process.env.KAIRO_ADR085_SAMPLE_COUNT, DEFAULT_CONFIG.sampleCount);

  const thresholds = {
    maxNativeSearchP95Ms: parseNumberEnv(
      process.env.KAIRO_SLO_NATIVE_SEARCH_P95_MS,
      DEFAULT_CONFIG.maxNativeSearchP95Ms
    ),
    maxFileSearchP95Ms: parseNumberEnv(
      process.env.KAIRO_SLO_FILE_SEARCH_P95_MS,
      DEFAULT_CONFIG.maxFileSearchP95Ms
    ),
    maxHeapDeltaMb: parseNumberEnv(
      process.env.KAIRO_SLO_HEAP_DELTA_MB,
      DEFAULT_CONFIG.maxHeapDeltaMb
    ),
    maxIndexSizeMb: parseNumberEnv(
      process.env.KAIRO_SLO_INDEX_SIZE_MB,
      DEFAULT_CONFIG.maxIndexSizeMb
    )
  };

  const fileList = [];
  const needles = [];

  try {
    generateFixtureRepo(root, fileCount, needleCount, fileList, needles);

    const heapBefore = process.memoryUsage().heapUsed;
    const rssBefore = process.memoryUsage().rss;

    const core = new NativeSearchCore(root, { repoId, writerMemoryMb: 256, kairoVersion: "adr-085-slo" });
    try {
      core.reset();
    } catch {
      // ignore reset absence
    }
    const indexer = new NativeSearchIndexer(core);

    for (const relPath of fileList) {
      const absPath = path.join(root, relPath);
      const content = fs.readFileSync(absPath, "utf-8");
      indexer.upsertCodeFile({
        repoId,
        filePath: relPath,
        content,
        contentHash: hashContent(content),
        mtimeMs: Date.now(),
        symbols: [],
        callgraphRank: 0
      });
    }
    indexer.flush();

    const stats = core.stats();
    const indexDir = core.getIndexDir();
    const indexSizeBytes = dirSize(indexDir);

    const heapAfterIndex = process.memoryUsage().heapUsed;
    const rssAfterIndex = process.memoryUsage().rss;

    const fsClient = new NodeFileSystem(root);
    const searchEngine = new SearchEngine(root, fsClient, [], { nativeSearchCore: core, repoId });

    // Warm up native readers / caches
    for (let i = 0; i < Math.min(10, needles.length); i += 1) {
      const query = needles[i];
      core.search({ kind: "code_file", query, limit: 20, repoIds: [repoId] });
      await searchEngine.scout({ query, basePath: root, matchesPerFile: 1, snippetLength: 80, maxResults: 10 });
    }

    const nativeLatencies = [];
    const fileSearchLatencies = [];

    for (let i = 0; i < sampleCount; i += 1) {
      const query = needles[i % needles.length];

      nativeLatencies.push(measure(() => core.search({ kind: "code_file", query, limit: 20, repoIds: [repoId] })));

      fileSearchLatencies.push(
        await measureAsync(() =>
          searchEngine.scout({ query, basePath: root, matchesPerFile: 1, snippetLength: 80, maxResults: 10 })
        )
      );
    }

    const report = {
      thresholds,
      config: { fileCount, needleCount, sampleCount },
      stats: {
        indexDocCount: stats.docCount,
        indexSizeMb: round(indexSizeBytes / (1024 * 1024), 3),
        heapDeltaMb: round((heapAfterIndex - heapBefore) / (1024 * 1024), 3),
        rssDeltaMb: round((rssAfterIndex - rssBefore) / (1024 * 1024), 3),
        nativeSearchMs: summarize(nativeLatencies),
        fileSearchMs: summarize(fileSearchLatencies)
      },
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch
      }
    };

    const reportDir = path.join("benchmarks", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `adr-085-search-slo-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`Wrote ADR-085 search SLO report to ${reportPath}`);

    const failures = [];
    const nativeP95 = report.stats.nativeSearchMs.p95;
    const fileP95 = report.stats.fileSearchMs.p95;

    if (!Number.isFinite(nativeP95) || nativeP95 > thresholds.maxNativeSearchP95Ms) {
      failures.push(`native search p95=${nativeP95.toFixed(2)}ms > ${thresholds.maxNativeSearchP95Ms}ms`);
    }
    if (!Number.isFinite(fileP95) || fileP95 > thresholds.maxFileSearchP95Ms) {
      failures.push(`file_search p95=${fileP95.toFixed(2)}ms > ${thresholds.maxFileSearchP95Ms}ms`);
    }

    const heapDeltaMb = report.stats.heapDeltaMb;
    if (!Number.isFinite(heapDeltaMb) || heapDeltaMb > thresholds.maxHeapDeltaMb) {
      failures.push(`heap delta=${heapDeltaMb.toFixed(2)}MB > ${thresholds.maxHeapDeltaMb}MB`);
    }

    const indexSizeMb = report.stats.indexSizeMb;
    if (!Number.isFinite(indexSizeMb) || indexSizeMb > thresholds.maxIndexSizeMb) {
      failures.push(`index size=${indexSizeMb.toFixed(2)}MB > ${thresholds.maxIndexSizeMb}MB`);
    }

    core.close();

    if (failures.length > 0) {
      console.error("ADR-085 search SLO gate failed:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function generateFixtureRepo(root, fileCount, needleCount, fileList, needles) {
  const srcDir = path.join(root, "src");
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  for (let i = 0; i < needleCount; i += 1) {
    needles.push(`NEEDLE${i}`);
  }

  // A few predictable filename-signal files.
  writeFile(root, "src/User.ts", "export const User = { name: 'User' };\n");
  writeFile(root, "src/UserManager.ts", "export class UserManager { constructor() { return 'UserManager'; } }\n");
  fileList.push("src/User.ts", "src/UserManager.ts");

  // Generate a mix of code and docs.
  for (let i = 0; i < fileCount; i += 1) {
    const moduleDir = `src/modules/m${Math.floor(i / 100)}`;
    const relPath = `${moduleDir}/file_${i}.ts`;
    const needle = needles[i % needles.length];
    const content = [
      `export function fn${i}() {`,
      `  const id = ${i};`,
      `  const marker = "${needle}";`,
      `  return id;`,
      `}`
    ].join("\n") + "\n";
    writeFile(root, relPath, content);
    fileList.push(relPath);
  }

  for (let i = 0; i < Math.max(20, Math.floor(fileCount / 50)); i += 1) {
    const needle = needles[i % needles.length];
    const relPath = `docs/doc_${i}.txt`;
    const content = `Doc ${i}\nThis document references ${needle} and some filler text.\n`;
    writeFile(root, relPath, content);
    fileList.push(relPath);
  }
}

function writeFile(root, relativePath, content) {
  const absPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
}

function measure(fn) {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

async function measureAsync(fn) {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function summarize(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { min: Number.NaN, max: Number.NaN, mean: Number.NaN, p50: Number.NaN, p95: Number.NaN };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95)
  };
}

function parseNumberEnv(raw, fallback) {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dirSize(targetPath) {
  let total = 0;
  let stats;
  try {
    stats = fs.statSync(targetPath);
  } catch {
    return 0;
  }
  if (!stats.isDirectory()) {
    return stats.size;
  }
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    total += dirSize(path.join(targetPath, entry.name));
  }
  return total;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

