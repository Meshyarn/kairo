import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.KAIRO_MODE = process.env.KAIRO_MODE ?? "mcp";
process.env.KAIRO_WARMUP_ENABLED = process.env.KAIRO_WARMUP_ENABLED ?? "false";
process.env.KAIRO_METRICS_MODE = process.env.KAIRO_METRICS_MODE ?? "basic";
process.env.KAIRO_STORAGE_MODE = process.env.KAIRO_STORAGE_MODE ?? "memory";
process.env.KAIRO_RUST_CORE_ENABLED = process.env.KAIRO_RUST_CORE_ENABLED ?? "false";
process.env.KAIRO_RUST_FILE_SCAN_ENABLED = process.env.KAIRO_RUST_FILE_SCAN_ENABLED ?? "false";

const DEFAULT_CONFIG = {
  fileCount: 1500,
  needleCount: 200,
  sampleCount: 40,
  maxScanP95Ms: 750,
  maxHeapDeltaMb: 128
};

async function main() {
  const { PathManager } = await import("../dist/utils/PathManager.js");
  const { NativeSearchCore } = await import("../dist/engine/search/native/NativeSearchCore.js");
  const { SearchEngine } = await import("../dist/engine/Search.js");
  const { NodeFileSystem } = await import("../dist/platform/FileSystem.js");
  const { EngineManager } = await import("../dist/orchestration/capabilities/EngineManager.js");
  const { CAP_FILE_SCAN } = await import("../dist/orchestration/capabilities/CapabilityIds.js");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr090-scan-slo-"));
  PathManager.setRoot(root);

  const fileCount = parseNumberEnv(process.env.KAIRO_ADR090_FILE_COUNT, DEFAULT_CONFIG.fileCount);
  const needleCount = parseNumberEnv(process.env.KAIRO_ADR090_NEEDLE_COUNT, DEFAULT_CONFIG.needleCount);
  const sampleCount = parseNumberEnv(process.env.KAIRO_ADR090_SAMPLE_COUNT, DEFAULT_CONFIG.sampleCount);
  const maxScanP95Ms = parseNumberEnv(process.env.KAIRO_SLO_SCAN_P95_MS, DEFAULT_CONFIG.maxScanP95Ms);
  const maxHeapDeltaMb = parseNumberEnv(process.env.KAIRO_SLO_SCAN_HEAP_DELTA_MB, DEFAULT_CONFIG.maxHeapDeltaMb);

  const needles = [];
  const fileList = [];

  try {
    generateFixtureRepo(root, fileCount, needleCount, fileList, needles);

    const heapBefore = process.memoryUsage().heapUsed;

    const core = new NativeSearchCore(root, { repoId: "default", kairoVersion: "adr-090-scan-slo" });
    const fsClient = new NodeFileSystem(root);
    const searchEngine = new SearchEngine(root, fsClient, [], { nativeSearchCore: core, repoId: "default" });

    // Warm up.
    for (let i = 0; i < Math.min(10, needles.length); i += 1) {
      const query = needles[i];
      await searchEngine.scout({ query, basePath: root, matchesPerFile: 1, snippetLength: 80, maxResults: 10 });
    }

    const scanLatencies = [];
    for (let i = 0; i < sampleCount; i += 1) {
      const query = needles[i % needles.length];
      scanLatencies.push(
        await measureAsync(() =>
          searchEngine.scout({ query, basePath: root, matchesPerFile: 1, snippetLength: 80, maxResults: 10 })
        )
      );
    }

    const heapAfter = process.memoryUsage().heapUsed;
    const diagnostics = EngineManager.getDiagnosticsSnapshot({ detail: "summary" });
    const scanCapability = diagnostics.capabilities?.[CAP_FILE_SCAN];

    const report = {
      thresholds: {
        maxScanP95Ms,
        maxHeapDeltaMb
      },
      config: {
        fileCount,
        needleCount,
        sampleCount
      },
      stats: {
        scanMs: summarize(scanLatencies),
        heapDeltaMb: round((heapAfter - heapBefore) / (1024 * 1024), 3)
      },
      capability: {
        selected: scanCapability?.selected ?? null,
        fallback: scanCapability?.fallback ?? null
      },
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch
      }
    };

    const reportDir = path.join("benchmarks", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `adr-090-native-scan-slo-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`Wrote ADR-090 native scan SLO report to ${reportPath}`);

    const failures = [];
    const scanP95 = report.stats.scanMs.p95;
    if (!Number.isFinite(scanP95) || scanP95 > maxScanP95Ms) {
      failures.push(`scan p95=${scanP95.toFixed(2)}ms > ${maxScanP95Ms}ms`);
    }
    const heapDeltaMb = report.stats.heapDeltaMb;
    if (!Number.isFinite(heapDeltaMb) || heapDeltaMb > maxHeapDeltaMb) {
      failures.push(`heap delta=${heapDeltaMb.toFixed(2)}MB > ${maxHeapDeltaMb}MB`);
    }

    core.close();

    if (failures.length > 0) {
      console.error("ADR-090 native scan SLO gate failed:");
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

  writeFile(root, "src/User.ts", "export const User = { name: 'User' };\n");
  writeFile(root, "src/UserManager.ts", "export class UserManager { constructor() { return 'UserManager'; } }\n");
  fileList.push("src/User.ts", "src/UserManager.ts");

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

function writeFile(root, relPath, content) {
  const absPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
}

function parseNumberEnv(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function measureAsync(fn) {
  const start = performance.now();
  return Promise.resolve(fn()).then(() => performance.now() - start);
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const mean = count === 0 ? 0 : sorted.reduce((sum, value) => sum + value, 0) / count;
  return {
    count,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: round(mean, 3),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99)
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return round(sorted[idx] ?? 0, 3);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

main().catch((error) => {
  console.error("ADR-090 native scan SLO gate crashed:", error);
  process.exitCode = 1;
});
