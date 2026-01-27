import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { resolveRepoRoot } from "../lib/repoRoot.js";

type ResultSummary = {
    pass_at_1: number;
    pass_at_k: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    total_cost?: number | null;
    wall_ms_total: number;
};

type ResultsFile = {
    run_id: string;
    mode: string;
    tool_mode?: string | null;
    model: { provider: string; id: string };
    summary: ResultSummary;
    cases?: Array<{ id: string; passed: boolean; pass_at_1: boolean }>;
};

function getArgValue(argv: string[], name: string): string | null {
    const idx = argv.indexOf(name);
    if (idx === -1) return null;
    const value = argv[idx + 1];
    return value ? String(value) : null;
}

function parseCaseFilter(value: string | null): string[] {
    if (!value) return [];
    return Array.from(
        new Set(
            value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
        )
    );
}

function slug(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function runSuite(params: {
    repoRoot: string;
    suitePath: string;
    provider: string;
    model: string;
    pricing?: string;
    toolMode: "baseline" | "kairo";
    runId: string;
    timeoutMs?: number;
    onlyCases?: string;
    excludeCases?: string;
    kairoBudget?: string;
}) {
    const args = [
        "--import",
        "tsx",
        "benchmarks/agent/run.ts",
        "--suite",
        params.suitePath,
        "--mode",
        "live",
        "--provider",
        params.provider,
        "--model",
        params.model,
        "--tool-mode",
        params.toolMode,
        "--run-id",
        params.runId
    ];
    if (params.timeoutMs) {
        args.push("--timeout-ms", String(params.timeoutMs));
    }
    if (params.pricing) {
        args.push("--pricing", params.pricing);
    }
    if (params.onlyCases) {
        args.push("--only", params.onlyCases);
    }
    if (params.excludeCases) {
        args.push("--exclude", params.excludeCases);
    }
    if (params.kairoBudget) {
        args.push("--kairo-budget", params.kairoBudget);
    }
    const result = spawnSync("node", args, {
        cwd: params.repoRoot,
        env: { ...process.env },
        stdio: "inherit"
    });
    if (result.status !== 0) {
        throw new Error(`Run failed for ${params.model} (${params.toolMode})`);
    }
}

function loadResults(repoRoot: string, runId: string): ResultsFile {
    const filePath = path.join(repoRoot, "benchmarks", "runs", runId, "results.json");
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ResultsFile;
}

function resolveResultsPath(input: string, repoRoot: string): string {
    const directPath = path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
    if (fs.existsSync(directPath)) {
        const stat = fs.statSync(directPath);
        if (stat.isFile()) return directPath;
        if (stat.isDirectory()) {
            const candidate = path.join(directPath, "results.json");
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    const runPath = path.join(repoRoot, "benchmarks", "runs", input, "results.json");
    if (fs.existsSync(runPath)) return runPath;
    throw new Error(`Results not found for input: ${input}`);
}

function loadResultsByInput(input: string, repoRoot: string): ResultsFile {
    const filePath = resolveResultsPath(input, repoRoot);
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ResultsFile;
}

function listFailedCases(results: ResultsFile): string[] {
    if (!results.cases) return [];
    return results.cases.filter((item) => item.passed === false).map((item) => item.id);
}

function listKairoWins(baseline: ResultsFile, kairo: ResultsFile): string[] {
    if (!baseline.cases || !kairo.cases) return [];
    const baselineById = new Map(baseline.cases.map((item) => [item.id, item]));
    const wins: string[] = [];
    for (const item of kairo.cases) {
        const base = baselineById.get(item.id);
        if (!base) continue;
        if (base.passed === false && item.passed === true) {
            wins.push(item.id);
        }
    }
    return wins;
}

function fmtRate(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function fmtDelta(baseline: number, current: number): string {
    const delta = current - baseline;
    const sign = delta >= 0 ? "+" : "";
    const pct = baseline !== 0 ? (delta / baseline) * 100 : 0;
    const pctSign = pct >= 0 ? "+" : "";
    return `${sign}${Math.round(delta)} (${pctSign}${pct.toFixed(1)}%)`;
}

function fmtCost(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    return value.toFixed(4);
}

function fmtCostDelta(baseline: number | null | undefined, current: number | null | undefined): string {
    if (typeof baseline !== "number" || typeof current !== "number") return "n/a";
    const delta = current - baseline;
    const sign = delta >= 0 ? "+" : "";
    const pct = baseline !== 0 ? (delta / baseline) * 100 : 0;
    const pctSign = pct >= 0 ? "+" : "";
    return `${sign}${delta.toFixed(4)} (${pctSign}${pct.toFixed(1)}%)`;
}

function writeReport(reportPath: string, runs: Record<string, ResultsFile>, mini: string, full: string) {
    const baselineMini = runs[`baseline:${mini}`];
    const kairoMini = runs[`kairo:${mini}`];
    const baselineFull = runs[`baseline:${full}`];
    const kairoFull = runs[`kairo:${full}`];

    const lines: string[] = [];
    lines.push("# Agent Benchmark Matrix Report");
    lines.push("");
    lines.push("## Runs");
    lines.push("| Label | Run ID | Tool Mode | Model | Pass@1 | In | Out | Total | Cost | Wall(ms) |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const [label, run] of Object.entries(runs)) {
        lines.push(
            `| ${label} | ${run.run_id} | ${run.tool_mode ?? "-"} | ${run.model.id} | ${fmtRate(run.summary.pass_at_1)} | ${Math.round(run.summary.input_tokens)} | ${Math.round(run.summary.output_tokens)} | ${Math.round(run.summary.total_tokens)} | ${fmtCost(run.summary.total_cost)} | ${Math.round(run.summary.wall_ms_total)} |`
        );
    }
    lines.push("");

    lines.push("## 1) Same Model, Different Tools");
    lines.push("| Comparison | Pass@1 Δ | In Δ | Out Δ | Total Δ | Cost Δ | Time Δ |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    lines.push(
        `| ${mini}: baseline → kairo | ${fmtDelta(baselineMini.summary.pass_at_1, kairoMini.summary.pass_at_1)} | ${fmtDelta(baselineMini.summary.input_tokens, kairoMini.summary.input_tokens)} | ${fmtDelta(baselineMini.summary.output_tokens, kairoMini.summary.output_tokens)} | ${fmtDelta(baselineMini.summary.total_tokens, kairoMini.summary.total_tokens)} | ${fmtCostDelta(baselineMini.summary.total_cost, kairoMini.summary.total_cost)} | ${fmtDelta(baselineMini.summary.wall_ms_total, kairoMini.summary.wall_ms_total)} |`
    );
    lines.push(
        `| ${full}: baseline → kairo | ${fmtDelta(baselineFull.summary.pass_at_1, kairoFull.summary.pass_at_1)} | ${fmtDelta(baselineFull.summary.input_tokens, kairoFull.summary.input_tokens)} | ${fmtDelta(baselineFull.summary.output_tokens, kairoFull.summary.output_tokens)} | ${fmtDelta(baselineFull.summary.total_tokens, kairoFull.summary.total_tokens)} | ${fmtCostDelta(baselineFull.summary.total_cost, kairoFull.summary.total_cost)} | ${fmtDelta(baselineFull.summary.wall_ms_total, kairoFull.summary.wall_ms_total)} |`
    );
    lines.push("");

    lines.push("## 2) Different Model, Same Tools");
    lines.push("| Tool Mode | Pass@1 Δ (mini → full) | In Δ | Out Δ | Total Δ | Cost Δ | Time Δ |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    lines.push(
        `| baseline | ${fmtDelta(baselineMini.summary.pass_at_1, baselineFull.summary.pass_at_1)} | ${fmtDelta(baselineMini.summary.input_tokens, baselineFull.summary.input_tokens)} | ${fmtDelta(baselineMini.summary.output_tokens, baselineFull.summary.output_tokens)} | ${fmtDelta(baselineMini.summary.total_tokens, baselineFull.summary.total_tokens)} | ${fmtCostDelta(baselineMini.summary.total_cost, baselineFull.summary.total_cost)} | ${fmtDelta(baselineMini.summary.wall_ms_total, baselineFull.summary.wall_ms_total)} |`
    );
    lines.push(
        `| kairo | ${fmtDelta(kairoMini.summary.pass_at_1, kairoFull.summary.pass_at_1)} | ${fmtDelta(kairoMini.summary.input_tokens, kairoFull.summary.input_tokens)} | ${fmtDelta(kairoMini.summary.output_tokens, kairoFull.summary.output_tokens)} | ${fmtDelta(kairoMini.summary.total_tokens, kairoFull.summary.total_tokens)} | ${fmtCostDelta(kairoMini.summary.total_cost, kairoFull.summary.total_cost)} | ${fmtDelta(kairoMini.summary.wall_ms_total, kairoFull.summary.wall_ms_total)} |`
    );
    lines.push("");

    lines.push("## 3) Cross: Mini+Kairo vs Full+Baseline");
    lines.push("| Comparison | Pass@1 Δ | In Δ | Out Δ | Total Δ | Cost Δ | Time Δ |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    lines.push(
        `| ${mini}+kairo → ${full}+baseline | ${fmtDelta(kairoMini.summary.pass_at_1, baselineFull.summary.pass_at_1)} | ${fmtDelta(kairoMini.summary.input_tokens, baselineFull.summary.input_tokens)} | ${fmtDelta(kairoMini.summary.output_tokens, baselineFull.summary.output_tokens)} | ${fmtDelta(kairoMini.summary.total_tokens, baselineFull.summary.total_tokens)} | ${fmtCostDelta(kairoMini.summary.total_cost, baselineFull.summary.total_cost)} | ${fmtDelta(kairoMini.summary.wall_ms_total, baselineFull.summary.wall_ms_total)} |`
    );

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, lines.join("\n"));
}

function main() {
    const argv = process.argv.slice(2);
    const repoRoot = resolveRepoRoot({ cwd: process.cwd(), fileHint: fileURLToPath(import.meta.url) });
    const suitePath = getArgValue(argv, "--suite") ?? "benchmarks/agent/suite.example.json";
    const provider = getArgValue(argv, "--provider") ?? "codex";
    const modelMini = getArgValue(argv, "--mini") ?? "gpt-5.1-codex-mini";
    const modelFull = getArgValue(argv, "--full") ?? "gpt-5.1-codex";
    const pricing = getArgValue(argv, "--pricing") ?? undefined;
    const timeoutMs = getArgValue(argv, "--timeout-ms");
    const timeoutValue = timeoutMs ? Number(timeoutMs) : undefined;
    const onlyCasesArg = getArgValue(argv, "--only") ?? getArgValue(argv, "--case");
    const excludeCases = getArgValue(argv, "--exclude") ?? getArgValue(argv, "--skip");
    const onlyFailedFrom = getArgValue(argv, "--only-failed-from");
    const onlyKairoWinsFrom = getArgValue(argv, "--only-kairo-wins-from");
    const kairoWinsKairoRun = getArgValue(argv, "--kairo-run");
    const kairoBudget = getArgValue(argv, "--kairo-budget");
    let onlyCasesList = parseCaseFilter(onlyCasesArg);
    if (onlyFailedFrom) {
        const failedCases = listFailedCases(loadResultsByInput(onlyFailedFrom, repoRoot));
        onlyCasesList = onlyCasesList.length > 0 ? onlyCasesList.filter((id) => failedCases.includes(id)) : failedCases;
    }
    if (onlyKairoWinsFrom) {
        if (!kairoWinsKairoRun) {
            throw new Error("Use --kairo-run <run-id> with --only-kairo-wins-from.");
        }
        const baseline = loadResultsByInput(onlyKairoWinsFrom, repoRoot);
        const kairo = loadResultsByInput(kairoWinsKairoRun, repoRoot);
        const wins = listKairoWins(baseline, kairo);
        onlyCasesList = onlyCasesList.length > 0 ? onlyCasesList.filter((id) => wins.includes(id)) : wins;
    }
    const onlyCases = onlyCasesList.length > 0 ? onlyCasesList.join(",") : undefined;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const runIds = {
        baselineMini: `agent-${timestamp}-baseline-${slug(modelMini)}`,
        kairoMini: `agent-${timestamp}-kairo-${slug(modelMini)}`,
        baselineFull: `agent-${timestamp}-baseline-${slug(modelFull)}`,
        kairoFull: `agent-${timestamp}-kairo-${slug(modelFull)}`
    };

    runSuite({
        repoRoot,
        suitePath,
        provider,
        model: modelMini,
        pricing,
        toolMode: "baseline",
        runId: runIds.baselineMini,
        timeoutMs: timeoutValue,
        onlyCases,
        excludeCases,
        kairoBudget
    });
    runSuite({
        repoRoot,
        suitePath,
        provider,
        model: modelMini,
        pricing,
        toolMode: "kairo",
        runId: runIds.kairoMini,
        timeoutMs: timeoutValue,
        onlyCases,
        excludeCases,
        kairoBudget
    });
    runSuite({
        repoRoot,
        suitePath,
        provider,
        model: modelFull,
        pricing,
        toolMode: "baseline",
        runId: runIds.baselineFull,
        timeoutMs: timeoutValue,
        onlyCases,
        excludeCases,
        kairoBudget
    });
    runSuite({
        repoRoot,
        suitePath,
        provider,
        model: modelFull,
        pricing,
        toolMode: "kairo",
        runId: runIds.kairoFull,
        timeoutMs: timeoutValue,
        onlyCases,
        excludeCases,
        kairoBudget
    });

    const runs: Record<string, ResultsFile> = {
        [`baseline:${modelMini}`]: loadResults(repoRoot, runIds.baselineMini),
        [`kairo:${modelMini}`]: loadResults(repoRoot, runIds.kairoMini),
        [`baseline:${modelFull}`]: loadResults(repoRoot, runIds.baselineFull),
        [`kairo:${modelFull}`]: loadResults(repoRoot, runIds.kairoFull)
    };

    const reportPath = path.join(repoRoot, "benchmarks", "reports", `agent-matrix-${timestamp}.md`);
    writeReport(reportPath, runs, modelMini, modelFull);
    console.log(`✅ Matrix report written: ${path.relative(repoRoot, reportPath)}`);
}

main();
