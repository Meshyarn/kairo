import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const ensureDistServer = () => {
  const distPath = path.resolve(process.cwd(), "dist", "index.js");
  if (!fs.existsSync(distPath)) {
    throw new Error(`dist server not found: ${distPath}. Run \`npm run build\` first.`);
  }
  return distPath;
};

const parseNumberEnv = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeId = (value) => String(value).replace(/[^a-zA-Z0-9_.=-]+/g, "_").slice(0, 120);

const pairKey = (i, vi, j, vj) => `${i}:${vi}|${j}:${vj}`;

const computeAllPairs = (factors) => {
  const all = new Set();
  for (let i = 0; i < factors.length; i += 1) {
    for (let j = i + 1; j < factors.length; j += 1) {
      for (const vi of factors[i].values) {
        for (const vj of factors[j].values) {
          all.add(pairKey(i, vi, j, vj));
        }
      }
    }
  }
  return all;
};

const markPairsCovered = (covered, factors, testCase) => {
  for (let i = 0; i < factors.length; i += 1) {
    for (let j = i + 1; j < factors.length; j += 1) {
      const vi = testCase[factors[i].id];
      const vj = testCase[factors[j].id];
      if (vi === undefined || vj === undefined) continue;
      covered.add(pairKey(i, vi, j, vj));
    }
  }
};

const generatePairwiseCases = (factors) => {
  if (factors.length === 0) return [];
  if (factors.length === 1) {
    return factors[0].values.map((v) => ({ [factors[0].id]: v }));
  }

  const covered = new Set();
  const cases = [];
  for (const v0 of factors[0].values) {
    for (const v1 of factors[1].values) {
      const entry = { [factors[0].id]: v0, [factors[1].id]: v1 };
      cases.push(entry);
      covered.add(pairKey(0, v0, 1, v1));
    }
  }

  for (let k = 2; k < factors.length; k += 1) {
    const factor = factors[k];

    for (const entry of cases) {
      let bestValue = factor.values[0];
      let bestScore = -1;
      for (const candidate of factor.values) {
        let score = 0;
        for (let j = 0; j < k; j += 1) {
          const prev = factors[j];
          const prevValue = entry[prev.id];
          const key = pairKey(j, prevValue, k, candidate);
          if (!covered.has(key)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestValue = candidate;
        }
      }
      entry[factor.id] = bestValue;
      for (let j = 0; j < k; j += 1) {
        const prev = factors[j];
        covered.add(pairKey(j, entry[prev.id], k, bestValue));
      }
    }

    const ensurePairs = () => {
      let added = 0;
      for (let j = 0; j < k; j += 1) {
        const prev = factors[j];
        for (const prevValue of prev.values) {
          for (const value of factor.values) {
            const key = pairKey(j, prevValue, k, value);
            if (covered.has(key)) continue;
            const entry = {};
            for (let m = 0; m < k; m += 1) {
              entry[factors[m].id] = factors[m].values[0];
            }
            entry[prev.id] = prevValue;
            entry[factor.id] = value;
            cases.push(entry);
            markPairsCovered(covered, factors.slice(0, k + 1), entry);
            added += 1;
          }
        }
      }
      return added;
    };

    while (ensurePairs() > 0) {
      // keep adding until all pairs with factor k are covered
    }
  }

  return cases;
};

const runNodeScript = async ({ scriptPath, env, timeoutMs, name }) => {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(process.execPath, [scriptPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
    child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

    let settled = false;
    const finalize = ({ code, signal, timedOut = false, error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      resolve({
        name,
        code,
        signal,
        timedOut,
        error,
        wallTimeMs: performance.now() - started,
        stdout: stdout.join(""),
        stderr: stderr.join("")
      });
    };

    const termTimer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 5000);
      killTimer.unref?.();
    }, timeoutMs);
    termTimer.unref?.();

    let killTimer;

    child.on("error", (error) => {
      finalize({
        code: null,
        signal: null,
        timedOut: false,
        error: error?.message ?? String(error)
      });
    });

    child.on("close", (code, signal) => {
      const timedOut = typeof signal === "string" && (signal === "SIGTERM" || signal === "SIGKILL");
      finalize({ code, signal, timedOut });
    });
  });
};

async function main() {
  ensureDistServer();

  const mode = (process.env.KAIRO_ADR088_MATRIX_MODE ?? "pairwise").trim().toLowerCase();
  const includeSearch = (process.env.KAIRO_ADR088_MATRIX_INCLUDE_SEARCH ?? "true").trim().toLowerCase() === "true";
  const searchNodeEnv = (process.env.KAIRO_ADR088_MATRIX_SEARCH_NODE_ENV ?? "test").trim() || "test";
  const caseLimit = parseNumberEnv(process.env.KAIRO_ADR088_MATRIX_CASE_LIMIT, undefined);
  const timeoutMs = parseNumberEnv(process.env.KAIRO_ADR088_MATRIX_TIMEOUT_MS, 240_000);

  const factors = [
    { id: "preset", values: ["mcp-lean", "mcp-balanced", "mcp-deep"] },
    { id: "rollout", values: ["legacy", "full"] },
    { id: "rustCore", values: ["true", "false"] },
    { id: "storage", values: ["memory", "file"] },
    { id: "metrics", values: ["basic", "detailed"] },
    { id: "logToFile", values: ["true", "false"] },
    { id: "warmup", values: ["true", "false"] },
    { id: "graphRag", values: ["true", "false"] },
    { id: "symbolicGuards", values: ["true", "false"] }
  ];

  let cases;
  if (mode === "full") {
    cases = [{}];
    for (const factor of factors) {
      const next = [];
      for (const entry of cases) {
        for (const value of factor.values) {
          next.push({ ...entry, [factor.id]: value });
        }
      }
      cases = next;
    }
  } else {
    cases = generatePairwiseCases(factors);
  }

  if (typeof caseLimit === "number" && caseLimit > 0) {
    cases = cases.slice(0, caseLimit);
  }

  const runId = Date.now();
  const reportDir = path.join(process.cwd(), "benchmarks", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const runDir = path.join(reportDir, `adr-088-env-matrix-${runId}`);
  fs.mkdirSync(runDir, { recursive: true });

  const allPairs = computeAllPairs(factors);
  const coveredPairs = new Set();
  for (const entry of cases) {
    markPairsCovered(coveredPairs, factors, entry);
  }

  const closureScript = path.resolve(process.cwd(), "scripts", "adr-088-stdio-guidance-closure.mjs");
  const searchScript = path.resolve(process.cwd(), "scripts", "adr-088-search-accuracy.mjs");

  const results = [];
  const failures = [];
  for (let index = 0; index < cases.length; index += 1) {
    const entry = cases[index];
    const preset = entry.preset;
    const caseName = sanitizeId(
      `case_${String(index + 1).padStart(3, "0")}` +
        `_p=${preset}` +
        `_ro=${entry.rollout}` +
        `_rc=${entry.rustCore}` +
        `_st=${entry.storage}` +
        `_mx=${entry.metrics}` +
        `_lg=${entry.logToFile}` +
        `_wu=${entry.warmup}` +
        `_gr=${entry.graphRag}` +
        `_sg=${entry.symbolicGuards}`
    );

    const closureReportPath = path.join(runDir, `${caseName}.closure.json`);
    const searchReportPath = path.join(runDir, `${caseName}.search.json`);

    const env = {
      ...process.env,
      NODE_ENV: "production",
      KAIRO_MODE: "mcp",
      KAIRO_PUBLIC_SURFACE: "compact",
      KAIRO_ALLOW_STDOUT_LOGS: "false",
      KAIRO_WARMUP_ENABLED: entry.warmup,
      KAIRO_HEARTBEAT: "false",
      KAIRO_EXPOSE_FILE_TOOLS: "false",
      KAIRO_ROLLOUT_MODE: entry.rollout,
      KAIRO_RUST_CORE_ENABLED: entry.rustCore,
      KAIRO_STORAGE_MODE: entry.storage,
      KAIRO_METRICS_MODE: entry.metrics,
      KAIRO_LOG_TO_FILE: entry.logToFile,
      KAIRO_GRAPHRAG_ENABLED: entry.graphRag,
      KAIRO_SYMBOLIC_GUARDS_ENABLED: entry.symbolicGuards,
      KAIRO_SYMBOLIC_GUARDS_MODE: entry.symbolicGuards === "true" ? "warn" : "off",
      KAIRO_ADR088_PRESETS: preset,
      KAIRO_ADR088_CLOSURE_REPORT_PATH: closureReportPath
    };

    console.log(`[ADR-088 env-matrix] Running ${index + 1}/${cases.length}: ${caseName}`);
    const closureRun = await runNodeScript({
      scriptPath: closureScript,
      env,
      timeoutMs,
      name: `closure:${caseName}`
    });

    let closurePayload;
    try {
      closurePayload = JSON.parse(fs.readFileSync(closureReportPath, "utf-8"));
    } catch {
      closurePayload = null;
    }

    let searchRun;
    let searchPayload;
    if (includeSearch) {
      const searchEnv = {
        ...env,
        NODE_ENV: searchNodeEnv,
        KAIRO_ADR088_SEARCH_REPORT_PATH: searchReportPath,
        KAIRO_ADR088_FILE_COUNT: process.env.KAIRO_ADR088_FILE_COUNT ?? "300",
        KAIRO_ADR088_QUERY_COUNT: process.env.KAIRO_ADR088_QUERY_COUNT ?? "60",
        KAIRO_ADR088_MAX_RESULTS: process.env.KAIRO_ADR088_MAX_RESULTS ?? "5"
      };
      searchRun = await runNodeScript({
        scriptPath: searchScript,
        env: searchEnv,
        timeoutMs,
        name: `search:${caseName}`
      });
      try {
        searchPayload = JSON.parse(fs.readFileSync(searchReportPath, "utf-8"));
      } catch {
        searchPayload = null;
      }
    }

    const ok =
      closureRun.code === 0 &&
      Boolean(closurePayload) &&
      Array.isArray(closurePayload?.runs) &&
      closurePayload.runs.every((run) => run?.summary?.failed === 0) &&
      (!includeSearch || (searchRun?.code === 0 && Boolean(searchPayload)));

    results.push({
      case: entry,
      name: caseName,
      ok,
      closure: {
        ok: closureRun.code === 0,
        wallTimeMs: closureRun.wallTimeMs,
        reportPath: closureReportPath,
        stderrTail: closureRun.stderr.trim().slice(-2000),
        stdoutTail: closureRun.stdout.trim().slice(-2000)
      },
      ...(includeSearch
        ? {
            search: {
              ok: searchRun?.code === 0,
              wallTimeMs: searchRun?.wallTimeMs,
              reportPath: searchReportPath,
              metrics: searchPayload?.metrics,
              latencyMs: searchPayload?.latencyMs,
              stderrTail: searchRun?.stderr?.trim?.().slice?.(-2000) ?? "",
              stdoutTail: searchRun?.stdout?.trim?.().slice?.(-2000) ?? ""
            }
          }
        : {})
    });

    if (!ok) {
      failures.push({
        name: caseName,
        closureExit: closureRun.code,
        searchExit: searchRun?.code ?? null,
        closureReportPath,
        ...(includeSearch ? { searchReportPath } : {}),
        stderrTail: closureRun.stderr.trim().slice(-2000),
        stdoutTail: closureRun.stdout.trim().slice(-2000)
      });
    }
  }

  const summarize = (entries) => {
    const values = entries.filter((v) => Number.isFinite(v));
    if (values.length === 0) return { n: 0, avg: null, p50: null, p95: null };
    const sorted = [...values].sort((a, b) => a - b);
    const pick = (ratio) => {
      const idx = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
      return sorted[idx];
    };
    const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    return { n: sorted.length, avg, p50: pick(0.5), p95: pick(0.95) };
  };

  const factorSummary = {};
  for (const factor of factors) {
    const buckets = {};
    for (const value of factor.values) {
      const matching = results.filter((r) => r?.case?.[factor.id] === value);
      const okCount = matching.filter((r) => r.ok).length;
      buckets[value] = {
        cases: matching.length,
        passRate: matching.length > 0 ? okCount / matching.length : null,
        closureWallTimeMs: summarize(matching.map((r) => r.closure?.wallTimeMs)),
        ...(includeSearch ? { searchWallTimeMs: summarize(matching.map((r) => r.search?.wallTimeMs)) } : {})
      };
    }
    factorSummary[factor.id] = buckets;
  }

  const matrixReport = {
    meta: {
      id: "adr-088-env-matrix",
      createdAt: runId,
      mode,
      includeSearch,
      cases: results.length,
      factors,
      pairwise: {
        totalPairs: allPairs.size,
        coveredPairs: coveredPairs.size,
        coverage: allPairs.size > 0 ? coveredPairs.size / allPairs.size : 1
      }
    },
    summary: {
      passRate: results.length > 0 ? results.filter((r) => r.ok).length / results.length : null,
      closureWallTimeMs: summarize(results.map((r) => r.closure?.wallTimeMs)),
      ...(includeSearch ? { searchWallTimeMs: summarize(results.map((r) => r.search?.wallTimeMs)) } : {}),
      factors: factorSummary
    },
    results,
    ...(failures.length > 0 ? { failures } : {})
  };

  const matrixPath = path.join(reportDir, `adr-088-env-matrix-${runId}.json`);
  fs.writeFileSync(matrixPath, JSON.stringify(matrixReport, null, 2), "utf-8");
  console.log(`Wrote ADR-088 env-matrix report to ${matrixPath}`);

  if (failures.length > 0) {
    console.error("ADR-088 env-matrix gate failed:");
    for (const failure of failures) {
      console.error(`- ${failure.name} (closureExit=${failure.closureExit}, searchExit=${failure.searchExit ?? "n/a"})`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("ADR-088 env-matrix run failed:", error);
  process.exitCode = 1;
});
