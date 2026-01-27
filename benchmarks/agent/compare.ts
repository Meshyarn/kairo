import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { resolveRepoRoot } from "../lib/repoRoot.js";

type ResultSummary = {
    total_cases: number;
    pass_at_1: number;
    pass_at_k: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    total_cost?: number | null;
    wall_ms_total: number;
};

type ResultCase = {
    id: string;
    category: string;
    pass_at_1: boolean;
    passed: boolean;
    metrics: {
        total_tokens: number;
        wall_ms_to_first_success?: number;
    };
};

type ResultsFile = {
    run_id: string;
    suite_id: string;
    suite_version: string;
    mode: string;
    model: { provider: string; id: string };
    pricing?: { snapshot?: string; currency?: string } | null;
    task_pack_hash?: string;
    summary: ResultSummary;
    cases: ResultCase[];
};

function getArgValue(argv: string[], name: string): string | null {
    const idx = argv.indexOf(name);
    if (idx === -1) return null;
    const value = argv[idx + 1];
    return value ? String(value) : null;
}

function resolveResultsPath(input: string, repoRoot: string): string {
    const directPath = path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
    if (fs.existsSync(directPath)) {
        const stat = fs.statSync(directPath);
        if (stat.isFile()) {
            return directPath;
        }
        if (stat.isDirectory()) {
            const candidate = path.join(directPath, "results.json");
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    const runPath = path.join(repoRoot, "benchmarks", "runs", input, "results.json");
    if (fs.existsSync(runPath)) {
        return runPath;
    }
    throw new Error(`Results not found for input: ${input}`);
}

function loadResults(input: string, repoRoot: string): ResultsFile {
    const filePath = resolveResultsPath(input, repoRoot);
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ResultsFile;
}

function formatRate(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function formatRateDelta(baseline: number, current: number): string {
    const delta = (current - baseline) * 100;
    const sign = delta >= 0 ? "+" : "";
    return `${sign}${delta.toFixed(1)}pp`;
}

function formatNumber(value: number): string {
    return `${Math.round(value)}`;
}

function formatDelta(baseline: number, current: number): string {
    const delta = current - baseline;
    const sign = delta >= 0 ? "+" : "";
    const pct = baseline !== 0 ? (delta / baseline) * 100 : 0;
    const pctSign = pct >= 0 ? "+" : "";
    return `${sign}${Math.round(delta)} (${pctSign}${pct.toFixed(1)}%)`;
}

function formatCost(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    return value.toFixed(4);
}

function formatCostDelta(baseline: number | null | undefined, current: number | null | undefined): string {
    if (typeof baseline !== "number" || typeof current !== "number") return "n/a";
    const delta = current - baseline;
    const sign = delta >= 0 ? "+" : "";
    const pct = baseline !== 0 ? (delta / baseline) * 100 : 0;
    const pctSign = pct >= 0 ? "+" : "";
    return `${sign}${delta.toFixed(4)} (${pctSign}${pct.toFixed(1)}%)`;
}

function groupByCategory(cases: ResultCase[]): Record<string, { total: number; passAt1: number; passAny: number }> {
    const groups: Record<string, { total: number; passAt1: number; passAny: number }> = {};
    for (const item of cases) {
        const group = groups[item.category] ?? { total: 0, passAt1: 0, passAny: 0 };
        group.total += 1;
        if (item.pass_at_1) group.passAt1 += 1;
        if (item.passed) group.passAny += 1;
        groups[item.category] = group;
    }
    return groups;
}

function writeReport(reportPath: string, baseline: ResultsFile, kairo: ResultsFile, labelA: string, labelB: string) {
    const summaryA = baseline.summary;
    const summaryB = kairo.summary;
    const currency = baseline.pricing?.currency ?? kairo.pricing?.currency ?? "USD";
    const report: string[] = [];
    report.push("# Agent Benchmark A/B Report");
    report.push("");
    report.push(`- Baseline: ${labelA}`);
    report.push(`- Kairo: ${labelB}`);
    report.push(`- Baseline Run ID: ${baseline.run_id}`);
    report.push(`- Kairo Run ID: ${kairo.run_id}`);
    report.push("");
    report.push("## Summary");
    report.push(`- Cost currency: ${currency}`);
    report.push("");
    report.push("| Metric | Baseline | Kairo | Delta |");
    report.push("| --- | --- | --- | --- |");
    report.push(`| Pass@1 | ${formatRate(summaryA.pass_at_1)} | ${formatRate(summaryB.pass_at_1)} | ${formatRateDelta(summaryA.pass_at_1, summaryB.pass_at_1)} |`);
    report.push(`| Pass@k | ${formatRate(summaryA.pass_at_k)} | ${formatRate(summaryB.pass_at_k)} | ${formatRateDelta(summaryA.pass_at_k, summaryB.pass_at_k)} |`);
    report.push(`| Input Tokens | ${formatNumber(summaryA.input_tokens)} | ${formatNumber(summaryB.input_tokens)} | ${formatDelta(summaryA.input_tokens, summaryB.input_tokens)} |`);
    report.push(`| Output Tokens | ${formatNumber(summaryA.output_tokens)} | ${formatNumber(summaryB.output_tokens)} | ${formatDelta(summaryA.output_tokens, summaryB.output_tokens)} |`);
    report.push(`| Total Tokens | ${formatNumber(summaryA.total_tokens)} | ${formatNumber(summaryB.total_tokens)} | ${formatDelta(summaryA.total_tokens, summaryB.total_tokens)} |`);
    report.push(`| Total Cost | ${formatCost(summaryA.total_cost)} | ${formatCost(summaryB.total_cost)} | ${formatCostDelta(summaryA.total_cost, summaryB.total_cost)} |`);
    report.push(`| Wall Time (ms) | ${formatNumber(summaryA.wall_ms_total)} | ${formatNumber(summaryB.wall_ms_total)} | ${formatDelta(summaryA.wall_ms_total, summaryB.wall_ms_total)} |`);
    report.push("");

    const baselineCategories = groupByCategory(baseline.cases);
    const kairoCategories = groupByCategory(kairo.cases);
    const categoryNames = Array.from(new Set([...Object.keys(baselineCategories), ...Object.keys(kairoCategories)])).sort();
    report.push("## Category Breakdown");
    report.push("| Category | Baseline Pass@1 | Kairo Pass@1 | Delta |");
    report.push("| --- | --- | --- | --- |");
    for (const category of categoryNames) {
        const base = baselineCategories[category] ?? { total: 0, passAt1: 0, passAny: 0 };
        const curr = kairoCategories[category] ?? { total: 0, passAt1: 0, passAny: 0 };
        const baseRate = base.total ? base.passAt1 / base.total : 0;
        const currRate = curr.total ? curr.passAt1 / curr.total : 0;
        report.push(`| ${category} | ${formatRate(baseRate)} | ${formatRate(currRate)} | ${formatRateDelta(baseRate, currRate)} |`);
    }
    report.push("");

    const baselineById = new Map(baseline.cases.map((item) => [item.id, item]));
    const kairoById = new Map(kairo.cases.map((item) => [item.id, item]));
    const allIds = Array.from(new Set([...baselineById.keys(), ...kairoById.keys()])).sort();
    const changes: Array<{
        id: string;
        category: string;
        baselinePass: boolean;
        kairoPass: boolean;
    }> = [];
    for (const id of allIds) {
        const base = baselineById.get(id);
        const curr = kairoById.get(id);
        if (!base || !curr) continue;
        if (base.passed !== curr.passed || base.pass_at_1 !== curr.pass_at_1) {
            changes.push({
                id,
                category: curr.category ?? base.category,
                baselinePass: base.passed,
                kairoPass: curr.passed
            });
        }
    }

    report.push("## Pass/Fail Changes");
    if (changes.length === 0) {
        report.push("- No pass/fail changes between baseline and Kairo.");
    } else {
        report.push("| Case | Category | Baseline | Kairo |");
        report.push("| --- | --- | --- | --- |");
        for (const change of changes) {
            report.push(`| ${change.id} | ${change.category} | ${change.baselinePass ? "pass" : "fail"} | ${change.kairoPass ? "pass" : "fail"} |`);
        }
    }

    const baselineOnly = baseline.cases.filter((item) => !kairoById.has(item.id)).map((item) => item.id);
    const kairoOnly = kairo.cases.filter((item) => !baselineById.has(item.id)).map((item) => item.id);
    if (baselineOnly.length || kairoOnly.length) {
        report.push("");
        report.push("## Case Mismatch");
        if (baselineOnly.length) {
            report.push(`- Only in baseline: ${baselineOnly.join(", ")}`);
        }
        if (kairoOnly.length) {
            report.push(`- Only in Kairo: ${kairoOnly.join(", ")}`);
        }
    }

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, report.join("\n"));
}

function main() {
    const argv = process.argv.slice(2);
    const baselineArg = getArgValue(argv, "--baseline");
    const kairoArg = getArgValue(argv, "--kairo");
    if (!baselineArg || !kairoArg) {
        console.error("Usage: --baseline <run-id|path> --kairo <run-id|path> [--out <path>] [--label-baseline <name>] [--label-kairo <name>]");
        process.exit(1);
    }
    const labelBaseline = getArgValue(argv, "--label-baseline") ?? baselineArg;
    const labelKairo = getArgValue(argv, "--label-kairo") ?? kairoArg;
    const repoRoot = resolveRepoRoot({ cwd: process.cwd(), fileHint: fileURLToPath(import.meta.url) });
    const baseline = loadResults(baselineArg, repoRoot);
    const kairo = loadResults(kairoArg, repoRoot);
    const outArg = getArgValue(argv, "--out");
    const reportPath = outArg
        ? (path.isAbsolute(outArg) ? outArg : path.resolve(repoRoot, outArg))
        : path.join(repoRoot, "benchmarks", "reports", `agent-ab-${baseline.run_id}-vs-${kairo.run_id}.md`);
    writeReport(reportPath, baseline, kairo, labelBaseline, labelKairo);
    console.log(`✅ A/B report written: ${path.relative(repoRoot, reportPath)}`);
}

main();
