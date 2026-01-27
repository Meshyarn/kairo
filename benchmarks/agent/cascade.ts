import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { resolveRepoRoot } from "../lib/repoRoot.js";

type ResultSummary = {
    total_cases: number;
    pass_at_1: number;
    pass_at_k: number;
    input_tokens: number;
    cached_input_tokens?: number;
    output_tokens: number;
    total_tokens: number;
    total_cost?: number | null;
    wall_ms_total: number;
};

type AttemptResult = {
    attempt: number;
    passed: boolean;
    duration_ms: number;
    patch_applied?: boolean;
    patch_error?: string;
    usage: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
    };
    validator_results?: Array<{ type: string; passed: boolean; details?: any }>;
};

type ResultCase = {
    id: string;
    category: string;
    description?: string;
    passed: boolean;
    attempts: number;
    pass_at_1: boolean;
    first_success_attempt?: number;
    metrics: {
        input_tokens: number;
        cached_input_tokens?: number;
        output_tokens: number;
        total_tokens: number;
        tokens_to_first_success?: number;
        cost_to_first_success?: number;
        total_cost?: number | null;
        wall_ms_to_first_success?: number;
    };
    attempt_results: AttemptResult[];
};

type ResultsFile = {
    run_id: string;
    suite_id: string;
    suite_version: string;
    mode: string;
    tool_mode?: string | null;
    model: { provider: string; id: string };
    pricing?: { snapshot?: string; currency?: string } | null;
    task_pack_hash?: string;
    summary: ResultSummary;
    spend_summary?: ResultSummary;
    cases: ResultCase[];
};

type CascadeManifest = {
    run_id: string;
    created_at?: string;
    mode?: string;
    pipeline_mode?: "cascade" | "route";
    stage_mode?: string;
    selected_cases?: string[];
    case_scope?: {
        mode?: string;
        detail?: string;
        scoped_cases?: string[];
        total_cases?: number;
    };
    gate?: {
        strategy?: string;
        detail?: string;
        escalated_cases?: string[];
    };
    routing?: {
        mode?: string;
        detail?: string;
        routed_cases?: string[];
        baseline_cases?: string[];
        total_cases?: number;
    };
    stage_runs: {
        baseline_mini?: string | null;
        kairo_mini?: string | null;
        baseline_full?: string | null;
    };
};

type SuiteValidator =
    | { type: "patch" }
    | { type: "json"; source?: string; expect?: any }
    | { type: "files"; files: Array<{ path: string }> };

type SuiteCase = {
    id: string;
    category: string;
    description?: string;
    validators?: SuiteValidator[];
};

type SuiteConfig = {
    suite_id: string;
    version: string;
    cases: SuiteCase[];
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

function parseNumber(value: string | null, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function slug(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function ensureDir(dirPath: string) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, value: any) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
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

function resolveRunDir(input: string, repoRoot: string): string {
    const directPath = path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
    if (fs.existsSync(directPath)) {
        const stat = fs.statSync(directPath);
        if (stat.isDirectory()) return directPath;
        if (stat.isFile()) return path.dirname(directPath);
    }
    const runPath = path.join(repoRoot, "benchmarks", "runs", input);
    if (fs.existsSync(runPath) && fs.statSync(runPath).isDirectory()) {
        return runPath;
    }
    throw new Error(`Run directory not found for input: ${input}`);
}

function loadResultsByInput(input: string, repoRoot: string): ResultsFile {
    const filePath = resolveResultsPath(input, repoRoot);
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ResultsFile;
}

function loadCascadeManifest(runDir: string): CascadeManifest {
    const manifestPath = path.join(runDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Cascade manifest not found: ${manifestPath}`);
    }
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CascadeManifest;
}

function runSuite(params: {
    repoRoot: string;
    suitePath: string;
    mode: "mock" | "live";
    provider: string;
    model: string;
    pricing?: string;
    toolMode: "baseline" | "kairo";
    runId: string;
    timeoutMs?: number;
    attempts?: number;
    runAllAttempts?: boolean;
    onlyCases?: string;
    excludeCases?: string;
    kairoBudget?: string;
    logLevel?: string;
}) {
    const args = [
        "--import",
        "tsx",
        "benchmarks/agent/run.ts",
        "--suite",
        params.suitePath,
        "--mode",
        params.mode,
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
    if (params.attempts) {
        args.push("--attempts", String(params.attempts));
    }
    if (params.runAllAttempts) {
        args.push("--run-all-attempts");
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
    if (params.logLevel) {
        args.push("--log-level", params.logLevel);
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

function listFailedCases(results: ResultsFile): string[] {
    return results.cases.filter((item) => item.passed === false).map((item) => item.id);
}

function pickTopByMetric<T>(items: T[], valueFn: (item: T) => number, topFraction: number): T[] {
    const safeFraction = Math.max(0, Math.min(1, topFraction));
    if (safeFraction === 0 || items.length === 0) return [];
    const count = Math.max(1, Math.ceil(items.length * safeFraction));
    const sorted = [...items].sort((a, b) => valueFn(b) - valueFn(a));
    return sorted.slice(0, count);
}

function rankByMetric<T>(items: T[], valueFn: (item: T) => number): Map<T, number> {
    const sorted = [...items].sort((a, b) => valueFn(a) - valueFn(b));
    const ranks = new Map<T, number>();
    sorted.forEach((item, idx) => ranks.set(item, idx));
    return ranks;
}

function caseWallMs(resultCase: ResultCase): number {
    if (resultCase.passed && typeof resultCase.metrics.wall_ms_to_first_success === "number") {
        return resultCase.metrics.wall_ms_to_first_success;
    }
    if (resultCase.attempt_results?.length) {
        return resultCase.attempt_results.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0);
    }
    return 0;
}

function countExpectedFiles(testCase: SuiteCase): number {
    const validators = testCase.validators ?? [];
    const paths = new Set<string>();
    for (const validator of validators) {
        if (validator.type !== "files") continue;
        for (const file of validator.files ?? []) {
            if (file.path) paths.add(file.path);
        }
    }
    return paths.size;
}

const DEFAULT_COMPLEX_CATEGORIES = ["feature", "ci", "db", "tests"];

function formatComplexDetail(filesMin: number, categories: string[]): string {
    return `complex=files>=${filesMin} or category in [${categories.join(", ")}]`;
}

function listComplexCases(suite: SuiteConfig, filesMin: number, categories: string[]): string[] {
    const categoryList = categories.length > 0 ? categories : DEFAULT_COMPLEX_CATEGORIES;
    return suite.cases
        .filter((testCase) => {
            const fileCount = countExpectedFiles(testCase);
            const categoryMatch = categoryList.includes(testCase.category);
            return fileCount >= filesMin || categoryMatch;
        })
        .map((item) => item.id);
}

function renumberAttemptResults(attemptResults: AttemptResult[], offset: number): AttemptResult[] {
    return attemptResults.map((item) => ({ ...item, attempt: item.attempt + offset }));
}

function buildCascadeResults(params: {
    cascadeRunId: string;
    provider: string;
    modelMini: string;
    baselineMini: ResultsFile;
    kairoMini: ResultsFile | null;
    gatedCaseIds: string[];
}) {
    const gated = new Set(params.gatedCaseIds);
    const kairoById = new Map(params.kairoMini?.cases.map((c) => [c.id, c]) ?? []);
    const cases: ResultCase[] = params.baselineMini.cases.map((baseCase) => {
        if (!gated.has(baseCase.id)) return baseCase;
        const kairoCase = kairoById.get(baseCase.id);
        if (!kairoCase) return baseCase;
        return {
            ...kairoCase,
            category: baseCase.category ?? kairoCase.category,
            description: baseCase.description ?? kairoCase.description
        };
    });

    const summary = summarizeCases(cases);
    const spendInput = params.baselineMini.summary.input_tokens + (params.kairoMini?.summary.input_tokens ?? 0);
    const spendCachedInput =
        (params.baselineMini.summary.cached_input_tokens ?? 0) + (params.kairoMini?.summary.cached_input_tokens ?? 0);
    const spendOutput = params.baselineMini.summary.output_tokens + (params.kairoMini?.summary.output_tokens ?? 0);
    const baseCost = params.baselineMini.summary.total_cost;
    const kairoCost = params.kairoMini?.summary.total_cost;
    const spendCost =
        typeof baseCost === "number" && typeof kairoCost === "number"
            ? baseCost + kairoCost
            : typeof baseCost === "number" && !params.kairoMini
              ? baseCost
              : null;
    const spendSummary: ResultSummary = {
        ...summary,
        input_tokens: spendInput,
        cached_input_tokens: spendCachedInput,
        output_tokens: spendOutput,
        total_tokens: spendInput + spendOutput,
        total_cost: spendCost,
        wall_ms_total: params.baselineMini.summary.wall_ms_total + (params.kairoMini?.summary.wall_ms_total ?? 0)
    };

    return {
        run_id: params.cascadeRunId,
        suite_id: params.baselineMini.suite_id,
        suite_version: params.baselineMini.suite_version,
        mode: "cascade",
        tool_mode: "cascade",
        model: { provider: params.provider, id: params.modelMini },
        pricing: params.baselineMini.pricing ?? null,
        task_pack_hash: params.baselineMini.task_pack_hash,
        summary,
        spend_summary: spendSummary,
        cases
    };
}

function buildRouteResults(params: {
    routeRunId: string;
    provider: string;
    modelMini: string;
    baselineMini: ResultsFile | null;
    kairoMini: ResultsFile | null;
    routedCaseIds: string[];
    selectedCaseIds: string[];
}) {
    const source = params.baselineMini ?? params.kairoMini;
    if (!source) {
        throw new Error("Route pipeline requires at least one stage run (baseline or kairo).");
    }
    const routed = new Set(params.routedCaseIds);
    const baselineById = new Map(params.baselineMini?.cases.map((c) => [c.id, c]) ?? []);
    const kairoById = new Map(params.kairoMini?.cases.map((c) => [c.id, c]) ?? []);
    const cases: ResultCase[] = params.selectedCaseIds.map((id) => {
        if (routed.has(id)) {
            const kairoCase = kairoById.get(id);
            if (!kairoCase) {
                throw new Error(`Missing routed (kairo) case result: ${id}`);
            }
            return kairoCase;
        }
        const baseCase = baselineById.get(id);
        if (!baseCase) {
            throw new Error(`Missing baseline case result: ${id}`);
        }
        return baseCase;
    });

    const summary = summarizeCases(cases);
    const spendInput = (params.baselineMini?.summary.input_tokens ?? 0) + (params.kairoMini?.summary.input_tokens ?? 0);
    const spendCachedInput =
        (params.baselineMini?.summary.cached_input_tokens ?? 0) + (params.kairoMini?.summary.cached_input_tokens ?? 0);
    const spendOutput =
        (params.baselineMini?.summary.output_tokens ?? 0) + (params.kairoMini?.summary.output_tokens ?? 0);
    const baseCost = params.baselineMini?.summary.total_cost;
    const kairoCost = params.kairoMini?.summary.total_cost;
    const spendCost =
        typeof baseCost === "number" && typeof kairoCost === "number"
            ? baseCost + kairoCost
            : typeof baseCost === "number" && !params.kairoMini
              ? baseCost
              : typeof kairoCost === "number" && !params.baselineMini
                ? kairoCost
                : null;
    const spendSummary: ResultSummary = {
        ...summary,
        input_tokens: spendInput,
        cached_input_tokens: spendCachedInput,
        output_tokens: spendOutput,
        total_tokens: spendInput + spendOutput,
        total_cost: spendCost,
        wall_ms_total:
            (params.baselineMini?.summary.wall_ms_total ?? 0) + (params.kairoMini?.summary.wall_ms_total ?? 0)
    };

    return {
        run_id: params.routeRunId,
        suite_id: source.suite_id,
        suite_version: source.suite_version,
        mode: "route",
        tool_mode: "route",
        model: { provider: params.provider, id: params.modelMini },
        pricing: params.baselineMini?.pricing ?? params.kairoMini?.pricing ?? null,
        task_pack_hash: source.task_pack_hash,
        summary,
        spend_summary: spendSummary,
        cases
    };
}

function formatRate(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
    return `${Math.round(value)}`;
}

function formatCost(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    return value.toFixed(4);
}

function formatDelta(baseline: number, current: number): string {
    const delta = current - baseline;
    const sign = delta >= 0 ? "+" : "";
    const pct = baseline !== 0 ? (delta / baseline) * 100 : 0;
    const pctSign = pct >= 0 ? "+" : "";
    return `${sign}${Math.round(delta)} (${pctSign}${pct.toFixed(1)}%)`;
}

function formatDeltaRate(baseline: number, current: number): string {
    const delta = current - baseline;
    const sign = delta >= 0 ? "+" : "";
    const baselinePct = baseline * 100;
    const pct = baselinePct !== 0 ? (delta * 100 / baselinePct) * 100 : 0;
    const pctSign = pct >= 0 ? "+" : "";
    return `${sign}${(delta * 100).toFixed(1)}pp (${pctSign}${pct.toFixed(1)}%)`;
}

function formatDeltaCost(baseline: number | null | undefined, current: number | null | undefined): string {
    if (typeof baseline !== "number" || typeof current !== "number") return "n/a";
    const delta = current - baseline;
    const sign = delta >= 0 ? "+" : "";
    const pct = baseline !== 0 ? (delta / baseline) * 100 : 0;
    const pctSign = pct >= 0 ? "+" : "";
    return `${sign}${delta.toFixed(4)} (${pctSign}${pct.toFixed(1)}%)`;
}

function summarizeCases(cases: ResultCase[]): ResultSummary {
    const totalCases = cases.length;
    const passedAt1 = cases.filter((c) => c.pass_at_1).length;
    const passedAny = cases.filter((c) => c.passed).length;
    const inputTokens = cases.reduce((sum, c) => sum + (c.metrics.input_tokens ?? 0), 0);
    const cachedInputTokens = cases.reduce((sum, c) => sum + (c.metrics.cached_input_tokens ?? 0), 0);
    const outputTokens = cases.reduce((sum, c) => sum + (c.metrics.output_tokens ?? 0), 0);
    const totalTokens = inputTokens + outputTokens;
    const hasAllCosts = cases.every((c) => typeof c.metrics.total_cost === "number");
    const totalCost = hasAllCosts ? cases.reduce((sum, c) => sum + (c.metrics.total_cost as number), 0) : null;
    const wallMsTotal = cases.reduce((sum, c) => sum + caseWallMs(c), 0);
    return {
        total_cases: totalCases,
        pass_at_1: totalCases ? passedAt1 / totalCases : 0,
        pass_at_k: totalCases ? passedAny / totalCases : 0,
        input_tokens: inputTokens,
        cached_input_tokens: cachedInputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        total_cost: totalCost,
        wall_ms_total: wallMsTotal
    };
}

function buildBlendedSummary(params: {
    baselineMini: ResultsFile;
    kairoMini: ResultsFile | null;
    gatedCaseIds: string[];
}): ResultSummary {
    const gated = new Set(params.gatedCaseIds);
    const kairoById = new Map(params.kairoMini?.cases.map((c) => [c.id, c]) ?? []);

    const blendedCases: ResultCase[] = params.baselineMini.cases.map((baseCase) => {
        if (!gated.has(baseCase.id)) return baseCase;
        return kairoById.get(baseCase.id) ?? baseCase;
    });

    return summarizeCases(blendedCases);
}

function writeCascadeReport(reportPath: string, runs: { cascade: ResultsFile; fullBaseline?: ResultsFile }, meta: any) {
    const report: string[] = [];
    report.push("# Agent Benchmark Cascade Report");
    report.push("");
    report.push("## Runs");
    report.push(`- Mini baseline run: ${meta.baselineMiniRunId}`);
    report.push(`- Mini kairo (gated) run: ${meta.kairoMiniRunId ?? "(skipped)"}`);
    report.push(`- Cascade run: ${runs.cascade.run_id}`);
    if (runs.fullBaseline) {
        report.push(`- Full baseline run: ${runs.fullBaseline.run_id}`);
    }
    report.push("");

    if (meta.caseScopeMode && meta.caseScopeMode !== "all") {
        report.push("## Case scope");
        report.push(`- Mode: ${meta.caseScopeMode}`);
        report.push(`- Detail: ${meta.caseScopeDetail ?? "(not recorded)"}`);
        if (Array.isArray(meta.caseScopeIds)) {
            const total = meta.caseScopeTotalCases ?? meta.totalCases ?? meta.caseScopeIds.length;
            report.push(
                `- Scoped cases: ${meta.caseScopeIds.length}/${total} (${formatRate(meta.caseScopeIds.length / total)})`
            );
            report.push(
                `- Scoped case IDs: ${meta.caseScopeIds.length ? meta.caseScopeIds.join(", ") : "(none)"}`
            );
        }
        report.push("");
    }

    report.push("## Gating");
    report.push(`- Strategy: ${meta.gateStrategy}`);
    report.push(`- Detail: ${meta.gateDetail}`);
    report.push(`- Escalated cases: ${meta.gatedCaseIds.length}/${meta.totalCases} (${formatRate(meta.gatedCaseIds.length / meta.totalCases)})`);
    report.push(`- Escalated case IDs: ${meta.gatedCaseIds.length ? meta.gatedCaseIds.join(", ") : "(none)"}`);
    report.push("");

    const kairoMiniSummary: ResultSummary | null = meta.kairoMiniSummary ?? null;
    const kairoMiniCases: number = meta.kairoMiniCases ?? meta.gatedCaseIds.length ?? 0;
    const blendedMiniSummary: ResultSummary = buildBlendedSummary({
        baselineMini: meta.baselineMiniResults,
        kairoMini: meta.kairoMiniResults ?? null,
        gatedCaseIds: meta.gatedCaseIds ?? []
    });
    const spendInputTokens = meta.baselineMiniSummary.input_tokens + (kairoMiniSummary?.input_tokens ?? 0);
    const spendCachedInputTokens =
        (meta.baselineMiniSummary.cached_input_tokens ?? 0) + (kairoMiniSummary?.cached_input_tokens ?? 0);
    const spendOutputTokens = meta.baselineMiniSummary.output_tokens + (kairoMiniSummary?.output_tokens ?? 0);
    const spendTotalTokens = meta.baselineMiniSummary.total_tokens + (kairoMiniSummary?.total_tokens ?? 0);
    const baselineMiniCost = meta.baselineMiniSummary.total_cost;
    const kairoMiniCost = kairoMiniSummary?.total_cost;
    const spendCost =
        typeof baselineMiniCost === "number" && typeof kairoMiniCost === "number"
            ? baselineMiniCost + kairoMiniCost
            : typeof baselineMiniCost === "number" && !kairoMiniSummary
              ? baselineMiniCost
              : null;
    const spendSummary: ResultSummary = meta.spendSummary ?? runs.cascade.spend_summary ?? {
        ...blendedMiniSummary,
        input_tokens: spendInputTokens,
        cached_input_tokens: spendCachedInputTokens,
        output_tokens: spendOutputTokens,
        total_tokens: spendTotalTokens,
        total_cost: spendCost,
        wall_ms_total: meta.baselineMiniSummary.wall_ms_total + (kairoMiniSummary?.wall_ms_total ?? 0)
    };

    report.push("## Summary");
    const currency =
        meta.baselineMiniResults?.pricing?.currency ?? runs.fullBaseline?.pricing?.currency ?? "USD";
    report.push(`- Cost currency: ${currency}`);
    report.push("");
    report.push("| System | Pass@1 | Pass(after gate) | In Tokens | Out Tokens | Total Tokens | Cost | Wall(ms) |");
    report.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    report.push(
        `| mini baseline | ${formatRate(meta.baselineMiniSummary.pass_at_1)} | ${formatRate(meta.baselineMiniSummary.pass_at_k)} | ${formatNumber(meta.baselineMiniSummary.input_tokens)} | ${formatNumber(meta.baselineMiniSummary.output_tokens)} | ${formatNumber(meta.baselineMiniSummary.total_tokens)} | ${formatCost(meta.baselineMiniSummary.total_cost)} | ${formatNumber(meta.baselineMiniSummary.wall_ms_total)} |`
    );
    if (kairoMiniSummary) {
        report.push(
            `| kairo increment (gated ${kairoMiniCases} case(s)) | ${formatRate(kairoMiniSummary.pass_at_1)} | ${formatRate(kairoMiniSummary.pass_at_k)} | ${formatNumber(kairoMiniSummary.input_tokens)} | ${formatNumber(kairoMiniSummary.output_tokens)} | ${formatNumber(kairoMiniSummary.total_tokens)} | ${formatCost(kairoMiniSummary.total_cost)} | ${formatNumber(kairoMiniSummary.wall_ms_total)} |`
        );
    }
    report.push(
        `| mini + kairo (gated, blended selection) | ${formatRate(blendedMiniSummary.pass_at_1)} | ${formatRate(blendedMiniSummary.pass_at_k)} | ${formatNumber(blendedMiniSummary.input_tokens)} | ${formatNumber(blendedMiniSummary.output_tokens)} | ${formatNumber(blendedMiniSummary.total_tokens)} | ${formatCost(blendedMiniSummary.total_cost)} | ${formatNumber(blendedMiniSummary.wall_ms_total)} |`
    );
    report.push(
        `| actual cascade spend (baseline + kairo increment) | ${formatRate(spendSummary.pass_at_1)} | ${formatRate(spendSummary.pass_at_k)} | ${formatNumber(spendSummary.input_tokens)} | ${formatNumber(spendSummary.output_tokens)} | ${formatNumber(spendSummary.total_tokens)} | ${formatCost(spendSummary.total_cost)} | ${formatNumber(spendSummary.wall_ms_total)} |`
    );
    if (runs.fullBaseline) {
        report.push(
            `| full baseline | ${formatRate(runs.fullBaseline.summary.pass_at_1)} | ${formatRate(runs.fullBaseline.summary.pass_at_k)} | ${formatNumber(runs.fullBaseline.summary.input_tokens)} | ${formatNumber(runs.fullBaseline.summary.output_tokens)} | ${formatNumber(runs.fullBaseline.summary.total_tokens)} | ${formatCost(runs.fullBaseline.summary.total_cost)} | ${formatNumber(runs.fullBaseline.summary.wall_ms_total)} |`
        );
    }
    report.push("");

    report.push("## Blend: mini baseline → blended selection");
    report.push("| Metric | Delta |");
    report.push("| --- | --- |");
    report.push(`| Pass(after gate) | ${formatDelta(meta.baselineMiniSummary.pass_at_k, blendedMiniSummary.pass_at_k)} |`);
    report.push(`| Input Tokens | ${formatDelta(meta.baselineMiniSummary.input_tokens, blendedMiniSummary.input_tokens)} |`);
    report.push(`| Output Tokens | ${formatDelta(meta.baselineMiniSummary.output_tokens, blendedMiniSummary.output_tokens)} |`);
    report.push(`| Total Tokens | ${formatDelta(meta.baselineMiniSummary.total_tokens, blendedMiniSummary.total_tokens)} |`);
    report.push(`| Cost | ${formatDeltaCost(meta.baselineMiniSummary.total_cost, blendedMiniSummary.total_cost)} |`);
    report.push(`| Wall Time (ms) | ${formatDelta(meta.baselineMiniSummary.wall_ms_total, blendedMiniSummary.wall_ms_total)} |`);
    report.push("");

    report.push("## Actual cascade spend: mini baseline → baseline+increment");
    report.push("| Metric | Delta |");
    report.push("| --- | --- |");
    report.push(`| Pass(after gate) | ${formatDelta(meta.baselineMiniSummary.pass_at_k, spendSummary.pass_at_k)} |`);
    report.push(`| Input Tokens | ${formatDelta(meta.baselineMiniSummary.input_tokens, spendSummary.input_tokens)} |`);
    report.push(`| Output Tokens | ${formatDelta(meta.baselineMiniSummary.output_tokens, spendSummary.output_tokens)} |`);
    report.push(`| Total Tokens | ${formatDelta(meta.baselineMiniSummary.total_tokens, spendSummary.total_tokens)} |`);
    report.push(`| Cost | ${formatDeltaCost(meta.baselineMiniSummary.total_cost, spendSummary.total_cost)} |`);
    report.push(`| Wall Time (ms) | ${formatDelta(meta.baselineMiniSummary.wall_ms_total, spendSummary.wall_ms_total)} |`);
    report.push("");

    if (runs.fullBaseline) {
        report.push("## Compare: blended selection vs full baseline");
        report.push("| Metric | Delta |");
        report.push("| --- | --- |");
        report.push(
            `| Pass(after gate) | ${formatDelta(runs.fullBaseline.summary.pass_at_k, blendedMiniSummary.pass_at_k)} |`
        );
        report.push(
            `| Input Tokens | ${formatDelta(runs.fullBaseline.summary.input_tokens, blendedMiniSummary.input_tokens)} |`
        );
        report.push(
            `| Output Tokens | ${formatDelta(runs.fullBaseline.summary.output_tokens, blendedMiniSummary.output_tokens)} |`
        );
        report.push(
            `| Total Tokens | ${formatDelta(runs.fullBaseline.summary.total_tokens, blendedMiniSummary.total_tokens)} |`
        );
        report.push(
            `| Cost | ${formatDeltaCost(runs.fullBaseline.summary.total_cost, blendedMiniSummary.total_cost)} |`
        );
        report.push(
            `| Wall Time (ms) | ${formatDelta(runs.fullBaseline.summary.wall_ms_total, blendedMiniSummary.wall_ms_total)} |`
        );
        report.push("");
    }

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, report.join("\n"));
}

function writeRouteReport(
    reportPath: string,
    runs: {
        route: ResultsFile;
        baselineMini?: ResultsFile | null;
        kairoMini?: ResultsFile | null;
        fullBaseline?: ResultsFile;
    },
    meta: any
) {
    const report: string[] = [];
    report.push("# Agent Benchmark Route Report");
    report.push("");
    report.push("## Runs");
    report.push(`- Mini baseline run: ${meta.baselineMiniRunId ?? "(skipped)"}`);
    report.push(`- Mini kairo run: ${meta.kairoMiniRunId ?? "(skipped)"}`);
    report.push(`- Route run: ${runs.route.run_id}`);
    if (runs.fullBaseline) {
        report.push(`- Full baseline run: ${runs.fullBaseline.run_id}`);
    }
    report.push("");

    if (meta.caseScopeMode && meta.caseScopeMode !== "all") {
        report.push("## Case scope");
        report.push(`- Mode: ${meta.caseScopeMode}`);
        report.push(`- Detail: ${meta.caseScopeDetail ?? "(not recorded)"}`);
        if (Array.isArray(meta.caseScopeIds)) {
            const total = meta.caseScopeTotalCases ?? meta.totalCases ?? meta.caseScopeIds.length;
            report.push(
                `- Scoped cases: ${meta.caseScopeIds.length}/${total} (${formatRate(meta.caseScopeIds.length / total)})`
            );
            report.push(`- Scoped case IDs: ${meta.caseScopeIds.length ? meta.caseScopeIds.join(", ") : "(none)"}`);
        }
        report.push("");
    }

    report.push("## Routing");
    report.push(`- Mode: ${meta.routeMode ?? "complex"}`);
    report.push(`- Detail: ${meta.routeDetail ?? "(not recorded)"}`);
    const routedIds: string[] = meta.routedCaseIds ?? [];
    const totalCases: number = meta.totalCases ?? routedIds.length;
    report.push(`- Routed cases: ${routedIds.length}/${totalCases} (${totalCases ? formatRate(routedIds.length / totalCases) : "0.0%"})`);
    report.push(`- Routed case IDs: ${routedIds.length ? routedIds.join(", ") : "(none)"}`);
    report.push("");

    const baseSummary = runs.baselineMini?.summary ?? null;
    const kairoSummary = runs.kairoMini?.summary ?? null;
    const routeSummary: ResultSummary = runs.route.summary;
    const spendSummary: ResultSummary = runs.route.spend_summary ?? runs.route.summary;

    report.push("## Summary");
    const currency = runs.route.pricing?.currency ?? runs.fullBaseline?.pricing?.currency ?? "USD";
    report.push(`- Cost currency: ${currency}`);
    report.push("");
    report.push("| System | Pass@1 | Pass | In Tokens | Out Tokens | Total Tokens | Cost | Wall(ms) |");
    report.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    if (baseSummary) {
        report.push(
            `| mini baseline (non-routed) | ${formatRate(baseSummary.pass_at_1)} | ${formatRate(baseSummary.pass_at_k)} | ${formatNumber(baseSummary.input_tokens)} | ${formatNumber(baseSummary.output_tokens)} | ${formatNumber(baseSummary.total_tokens)} | ${formatCost(baseSummary.total_cost)} | ${formatNumber(baseSummary.wall_ms_total)} |`
        );
    }
    if (kairoSummary) {
        report.push(
            `| mini kairo (routed) | ${formatRate(kairoSummary.pass_at_1)} | ${formatRate(kairoSummary.pass_at_k)} | ${formatNumber(kairoSummary.input_tokens)} | ${formatNumber(kairoSummary.output_tokens)} | ${formatNumber(kairoSummary.total_tokens)} | ${formatCost(kairoSummary.total_cost)} | ${formatNumber(kairoSummary.wall_ms_total)} |`
        );
    }
    report.push(
        `| mini routed selection | ${formatRate(routeSummary.pass_at_1)} | ${formatRate(routeSummary.pass_at_k)} | ${formatNumber(routeSummary.input_tokens)} | ${formatNumber(routeSummary.output_tokens)} | ${formatNumber(routeSummary.total_tokens)} | ${formatCost(routeSummary.total_cost)} | ${formatNumber(routeSummary.wall_ms_total)} |`
    );
    report.push(
        `| actual route spend (baseline+kairo) | ${formatRate(spendSummary.pass_at_1)} | ${formatRate(spendSummary.pass_at_k)} | ${formatNumber(spendSummary.input_tokens)} | ${formatNumber(spendSummary.output_tokens)} | ${formatNumber(spendSummary.total_tokens)} | ${formatCost(spendSummary.total_cost)} | ${formatNumber(spendSummary.wall_ms_total)} |`
    );
    if (runs.fullBaseline) {
        report.push(
            `| full baseline | ${formatRate(runs.fullBaseline.summary.pass_at_1)} | ${formatRate(runs.fullBaseline.summary.pass_at_k)} | ${formatNumber(runs.fullBaseline.summary.input_tokens)} | ${formatNumber(runs.fullBaseline.summary.output_tokens)} | ${formatNumber(runs.fullBaseline.summary.total_tokens)} | ${formatCost(runs.fullBaseline.summary.total_cost)} | ${formatNumber(runs.fullBaseline.summary.wall_ms_total)} |`
        );
    }
    report.push("");

    if (runs.fullBaseline) {
        report.push("## Compare: routed selection vs full baseline");
        report.push("| Metric | Delta |");
        report.push("| --- | --- |");
        report.push(`| Pass@1 | ${formatDeltaRate(runs.fullBaseline.summary.pass_at_1, routeSummary.pass_at_1)} |`);
        report.push(`| Pass@k | ${formatDeltaRate(runs.fullBaseline.summary.pass_at_k, routeSummary.pass_at_k)} |`);
        report.push(`| Input Tokens | ${formatDelta(runs.fullBaseline.summary.input_tokens, routeSummary.input_tokens)} |`);
        report.push(`| Output Tokens | ${formatDelta(runs.fullBaseline.summary.output_tokens, routeSummary.output_tokens)} |`);
        report.push(`| Total Tokens | ${formatDelta(runs.fullBaseline.summary.total_tokens, routeSummary.total_tokens)} |`);
        report.push(`| Cost | ${formatDeltaCost(runs.fullBaseline.summary.total_cost, routeSummary.total_cost)} |`);
        report.push(`| Wall Time (ms) | ${formatDelta(runs.fullBaseline.summary.wall_ms_total, routeSummary.wall_ms_total)} |`);
        report.push("");
    }

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, report.join("\n"));
}

function main() {
    const argv = process.argv.slice(2);
    const repoRoot = resolveRepoRoot({ cwd: process.cwd(), fileHint: fileURLToPath(import.meta.url) });
    const replayFrom = getArgValue(argv, "--replay-from");
    const outArg = getArgValue(argv, "--out");
    const suitePath = getArgValue(argv, "--suite") ?? "benchmarks/agent/suite.example.json";
    const modeArg = getArgValue(argv, "--mode") ?? "live";
    if (modeArg !== "mock" && modeArg !== "live") {
        throw new Error(`Unsupported mode: ${modeArg}. (supported: mock|live)`);
    }
    const mode = modeArg;
    const provider = getArgValue(argv, "--provider") ?? "codex";
    const modelMini = getArgValue(argv, "--mini") ?? "gpt-5.1-codex-mini";
    const modelFull = getArgValue(argv, "--full") ?? "gpt-5.1-codex";
    const timeoutMsArg = getArgValue(argv, "--timeout-ms");
    const timeoutMs = timeoutMsArg ? Number(timeoutMsArg) : undefined;
    const attemptsArg = getArgValue(argv, "--attempts");
    const attempts = attemptsArg ? Number(attemptsArg) : undefined;
    const runAllAttempts = argv.includes("--run-all-attempts");
    const kairoBudget = getArgValue(argv, "--kairo-budget") ?? undefined;
    const pricing = getArgValue(argv, "--pricing") ?? undefined;
    const logLevel = getArgValue(argv, "--log-level") ?? "progress";

    if (replayFrom) {
        const runDir = resolveRunDir(replayFrom, repoRoot);
        const manifest = loadCascadeManifest(runDir);
        const pipelineMode: "cascade" | "route" =
            manifest.pipeline_mode ??
            (manifest.mode === "route" ? "route" : "cascade");
        const caseScopeMode = manifest.case_scope?.mode;
        const caseScopeDetail = manifest.case_scope?.detail;
        const caseScopeIds = manifest.case_scope?.scoped_cases ?? null;
        const caseScopeTotalCases = manifest.case_scope?.total_cases ?? null;
        const baselineMini = manifest.stage_runs.baseline_mini
            ? loadResultsByInput(manifest.stage_runs.baseline_mini, repoRoot)
            : null;
        const kairoMini = manifest.stage_runs.kairo_mini ? loadResultsByInput(manifest.stage_runs.kairo_mini, repoRoot) : null;
        const fullBaseline = manifest.stage_runs.baseline_full
            ? loadResultsByInput(manifest.stage_runs.baseline_full, repoRoot)
            : undefined;

        const selectedCaseIds =
            manifest.selected_cases ??
            Array.from(
                new Set<string>([
                    ...(baselineMini?.cases.map((c) => c.id) ?? []),
                    ...(kairoMini?.cases.map((c) => c.id) ?? [])
                ])
            ).sort();

        if (pipelineMode === "route") {
            const routedCaseIds = manifest.routing?.routed_cases ?? [];
            const routeResults = buildRouteResults({
                routeRunId: manifest.run_id,
                provider: (baselineMini ?? kairoMini)?.model?.provider ?? "unknown",
                modelMini: (baselineMini ?? kairoMini)?.model?.id ?? manifest.run_id,
                baselineMini,
                kairoMini,
                routedCaseIds,
                selectedCaseIds
            });

            const reportPath = outArg
                ? (path.isAbsolute(outArg) ? outArg : path.resolve(repoRoot, outArg))
                : path.join(repoRoot, "benchmarks", "reports", `agent-route-${manifest.run_id}.md`);

            writeJson(path.join(runDir, "results.json"), routeResults);
            writeRouteReport(
                reportPath,
                { route: routeResults as ResultsFile, baselineMini, kairoMini, fullBaseline },
                {
                    baselineMiniRunId: manifest.stage_runs.baseline_mini ?? null,
                    kairoMiniRunId: manifest.stage_runs.kairo_mini ?? null,
                    caseScopeMode,
                    caseScopeDetail,
                    caseScopeIds,
                    caseScopeTotalCases,
                    routeMode: manifest.routing?.mode ?? "complex",
                    routeDetail: manifest.routing?.detail ?? "(not recorded)",
                    routedCaseIds,
                    totalCases: selectedCaseIds.length
                }
            );
            console.log(`✅ Route report written: ${path.relative(repoRoot, reportPath)}`);
            console.log(`✅ Route results rewritten: ${path.relative(repoRoot, path.join(runDir, "results.json"))}`);
            return;
        }

        const gatedCaseIds = manifest.gate?.escalated_cases ?? [];
        if (!baselineMini) {
            throw new Error("Cascade replay requires baseline_mini results in the manifest.");
        }
        const cascadeResults = buildCascadeResults({
            cascadeRunId: manifest.run_id,
            provider: baselineMini.model?.provider ?? "unknown",
            modelMini: baselineMini.model?.id ?? manifest.run_id,
            baselineMini,
            kairoMini,
            gatedCaseIds
        });

        const reportPath = outArg
            ? (path.isAbsolute(outArg) ? outArg : path.resolve(repoRoot, outArg))
            : path.join(repoRoot, "benchmarks", "reports", `agent-cascade-${manifest.run_id}.md`);

        writeJson(path.join(runDir, "results.json"), cascadeResults);
        writeCascadeReport(
            reportPath,
            { cascade: cascadeResults as ResultsFile, fullBaseline },
            {
                baselineMiniRunId: manifest.stage_runs.baseline_mini,
                kairoMiniRunId: manifest.stage_runs.kairo_mini ?? null,
                baselineMiniResults: baselineMini,
                kairoMiniResults: kairoMini,
                baselineMiniSummary: baselineMini.summary,
                kairoMiniSummary: kairoMini?.summary ?? null,
                kairoMiniCases: kairoMini?.summary.total_cases ?? 0,
                caseScopeMode,
                caseScopeDetail,
                caseScopeIds,
                caseScopeTotalCases,
                gateStrategy: manifest.gate?.strategy ?? "unknown",
                gateDetail: manifest.gate?.detail ?? "(not recorded)",
                gatedCaseIds,
                totalCases: baselineMini.summary.total_cases,
                spendSummary: cascadeResults.spend_summary ?? null
            }
        );
        console.log(`✅ Cascade report written: ${path.relative(repoRoot, reportPath)}`);
        console.log(`✅ Cascade results rewritten: ${path.relative(repoRoot, path.join(runDir, "results.json"))}`);
        return;
    }

    const onlyCasesArg = getArgValue(argv, "--only") ?? getArgValue(argv, "--case");
    const excludeCasesArg = getArgValue(argv, "--exclude") ?? getArgValue(argv, "--skip");
    const onlyCasesList = parseCaseFilter(onlyCasesArg);
    const excludeCasesList = parseCaseFilter(excludeCasesArg);
    const pipelineArg = (getArgValue(argv, "--pipeline") ?? "cascade").trim();

    const gateArg = (getArgValue(argv, "--gate") ?? "fail").trim();
    const gateStrategies = Array.from(
        new Set(
            gateArg
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
        )
    );
    const gateTop = parseNumber(getArgValue(argv, "--gate-top"), 0.3);
    const gateMetric = (getArgValue(argv, "--gate-metric") ?? "tokens").trim();
    const gateFilesMin = parseNumber(getArgValue(argv, "--gate-files-min"), 2);
    const gateCategories = parseCaseFilter(getArgValue(argv, "--gate-category"));
    const caseScopeArg = (getArgValue(argv, "--case-scope") ?? "all").trim();
    for (const strategy of gateStrategies) {
        if (!["fail", "cost", "complex"].includes(strategy)) {
            throw new Error(`Unsupported gate strategy: ${strategy}. (supported: fail|cost|complex)`);
        }
    }
    if (!["tokens", "time", "both"].includes(gateMetric)) {
        throw new Error(`Unsupported gate metric: ${gateMetric}. (supported: tokens|time|both)`);
    }
    if (!["all", "complex"].includes(caseScopeArg)) {
        throw new Error(`Unsupported case scope: ${caseScopeArg}. (supported: all|complex)`);
    }
    if (!["cascade", "route"].includes(pipelineArg)) {
        throw new Error(`Unsupported pipeline: ${pipelineArg}. (supported: cascade|route)`);
    }

    const suite: SuiteConfig = JSON.parse(fs.readFileSync(suitePath, "utf8"));
    const caseScopeIds =
        caseScopeArg === "complex"
            ? listComplexCases(suite, gateFilesMin, gateCategories)
            : null;
    const caseScopeDetail =
        caseScopeArg === "complex"
            ? formatComplexDetail(gateFilesMin, gateCategories.length > 0 ? gateCategories : DEFAULT_COMPLEX_CATEGORIES)
            : "all cases";
    if (caseScopeArg === "complex" && (!caseScopeIds || caseScopeIds.length === 0)) {
        throw new Error("No cases selected for --case-scope complex.");
    }

    let filteredCaseIds: string[] | null = caseScopeIds ? [...caseScopeIds] : null;
    if (onlyCasesList.length > 0) {
        filteredCaseIds = filteredCaseIds
            ? filteredCaseIds.filter((id) => onlyCasesList.includes(id))
            : [...onlyCasesList];
    }
    if (excludeCasesList.length > 0 && filteredCaseIds) {
        const excludeSet = new Set(excludeCasesList);
        filteredCaseIds = filteredCaseIds.filter((id) => !excludeSet.has(id));
    }
    if (filteredCaseIds && filteredCaseIds.length === 0) {
        throw new Error("No cases selected after applying case scope/filters.");
    }
    const onlyCases = filteredCaseIds && filteredCaseIds.length > 0 ? filteredCaseIds.join(",") : undefined;
    const excludeCases = !onlyCases && excludeCasesList.length > 0 ? excludeCasesList.join(",") : undefined;
    const suiteCaseIds = suite.cases.map((testCase) => testCase.id);
    const selectedCaseIds = onlyCases
        ? suiteCaseIds.filter((id) => (filteredCaseIds ?? []).includes(id))
        : excludeCasesList.length > 0
          ? suiteCaseIds.filter((id) => !excludeCasesList.includes(id))
          : suiteCaseIds;
    if (selectedCaseIds.length === 0) {
        throw new Error("No cases selected after applying filters.");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runIds =
        pipelineArg === "route"
            ? {
                  baselineMini: `agent-${timestamp}-route-baseline-${slug(modelMini)}`,
                  kairoMini: `agent-${timestamp}-route-kairo-${slug(modelMini)}`,
                  route: `agent-${timestamp}-route-${slug(modelMini)}`,
                  baselineFull: `agent-${timestamp}-route-baseline-${slug(modelFull)}`
              }
            : {
                  baselineMini: `agent-${timestamp}-cascade-baseline-${slug(modelMini)}`,
                  kairoMini: `agent-${timestamp}-cascade-kairo-${slug(modelMini)}`,
                  cascade: `agent-${timestamp}-cascade-${slug(modelMini)}`,
                  baselineFull: `agent-${timestamp}-cascade-baseline-${slug(modelFull)}`
              };

    if (pipelineArg === "route") {
        const complexCaseIds = listComplexCases(suite, gateFilesMin, gateCategories);
        const complexSet = new Set(complexCaseIds);
        const routedCaseIds = selectedCaseIds.filter((id) => complexSet.has(id));
        const baselineCaseIds = selectedCaseIds.filter((id) => !complexSet.has(id));
        const routeCategories = gateCategories.length > 0 ? gateCategories : DEFAULT_COMPLEX_CATEGORIES;
        const routeDetail = formatComplexDetail(gateFilesMin, routeCategories);

        let baselineMini: ResultsFile | null = null;
        let baselineMiniRunId: string | null = null;
        if (baselineCaseIds.length > 0) {
            baselineMiniRunId = runIds.baselineMini;
            runSuite({
                repoRoot,
                suitePath,
                mode,
                provider,
                model: modelMini,
                pricing,
                toolMode: "baseline",
                runId: runIds.baselineMini,
                timeoutMs,
                attempts,
                runAllAttempts,
                onlyCases: baselineCaseIds.join(","),
                logLevel
            });
            baselineMini = loadResultsByInput(runIds.baselineMini, repoRoot);
        }

        let kairoMini: ResultsFile | null = null;
        let kairoMiniRunId: string | null = null;
        if (routedCaseIds.length > 0) {
            kairoMiniRunId = runIds.kairoMini;
            runSuite({
                repoRoot,
                suitePath,
                mode,
                provider,
                model: modelMini,
                pricing,
                toolMode: "kairo",
                runId: runIds.kairoMini,
                timeoutMs,
                attempts,
                runAllAttempts,
                onlyCases: routedCaseIds.join(","),
                logLevel,
                kairoBudget
            });
            kairoMini = loadResultsByInput(runIds.kairoMini, repoRoot);
        }

        runSuite({
            repoRoot,
            suitePath,
            mode,
            provider,
            model: modelFull,
            pricing,
            toolMode: "baseline",
            runId: runIds.baselineFull,
            timeoutMs,
            attempts,
            runAllAttempts,
            onlyCases: selectedCaseIds.join(","),
            logLevel
        });
        const fullBaseline = loadResultsByInput(runIds.baselineFull, repoRoot);

        const routeResults = buildRouteResults({
            routeRunId: runIds.route,
            provider,
            modelMini,
            baselineMini,
            kairoMini,
            routedCaseIds,
            selectedCaseIds
        });

        const routeRunDir = path.join(repoRoot, "benchmarks", "runs", runIds.route);
        ensureDir(routeRunDir);
        writeJson(path.join(routeRunDir, "manifest.json"), {
            run_id: runIds.route,
            created_at: new Date().toISOString(),
            mode: "route",
            pipeline_mode: "route",
            stage_mode: mode,
            suite_id: routeResults.suite_id,
            suite_version: routeResults.suite_version,
            suite_path: path.relative(repoRoot, suitePath),
            selected_cases: selectedCaseIds,
            model: { provider, id: modelMini },
            case_scope: {
                mode: caseScopeArg,
                detail: caseScopeDetail,
                scoped_cases: caseScopeIds ?? undefined,
                total_cases: suite.cases.length
            },
            routing: {
                mode: "complex",
                detail: routeDetail,
                routed_cases: routedCaseIds,
                baseline_cases: baselineCaseIds,
                total_cases: selectedCaseIds.length
            },
            stage_runs: {
                baseline_mini: baselineMiniRunId,
                kairo_mini: kairoMiniRunId,
                baseline_full: runIds.baselineFull
            }
        });
        writeJson(path.join(routeRunDir, "results.json"), routeResults);

        const reportPath = path.join(repoRoot, "benchmarks", "reports", `agent-route-${timestamp}.md`);
        writeRouteReport(
            reportPath,
            { route: routeResults as ResultsFile, baselineMini, kairoMini, fullBaseline },
            {
                baselineMiniRunId: baselineMiniRunId,
                kairoMiniRunId: kairoMiniRunId,
                caseScopeMode: caseScopeArg,
                caseScopeDetail,
                caseScopeIds: caseScopeIds ?? null,
                caseScopeTotalCases: suite.cases.length,
                routeMode: "complex",
                routeDetail,
                routedCaseIds,
                totalCases: selectedCaseIds.length
            }
        );
        console.log(`✅ Route report written: ${path.relative(repoRoot, reportPath)}`);
        console.log(`✅ Route results written: ${path.relative(repoRoot, path.join(routeRunDir, "results.json"))}`);
        return;
    }

    runSuite({
        repoRoot,
        suitePath,
        mode,
        provider,
        model: modelMini,
        pricing,
        toolMode: "baseline",
        runId: runIds.baselineMini,
        timeoutMs,
        attempts,
        runAllAttempts,
        onlyCases,
        excludeCases,
        logLevel
    });

    const baselineMini = loadResultsByInput(runIds.baselineMini, repoRoot);
    const suiteById = new Map(suite.cases.map((testCase) => [testCase.id, testCase]));
    const gated = new Set<string>();
    const gateDetailParts: string[] = [];
    const cases = baselineMini.cases;
    const hasCostMetrics = cases.some((c) => typeof c.metrics.total_cost === "number");
    const costMetric = (c: ResultCase) => (typeof c.metrics.total_cost === "number" ? c.metrics.total_cost : c.metrics.total_tokens);
    for (const strategy of gateStrategies) {
        if (strategy === "fail") {
            for (const id of listFailedCases(baselineMini)) gated.add(id);
            gateDetailParts.push("fail=baseline-mini failures");
            continue;
        }
        if (strategy === "cost") {
            let selected: string[] = [];
            if (gateMetric === "tokens") {
                selected = pickTopByMetric(cases, costMetric, gateTop).map((c) => c.id);
                gateDetailParts.push(
                    hasCostMetrics
                        ? `cost=top ${(gateTop * 100).toFixed(0)}% by estimated cost`
                        : `cost=top ${(gateTop * 100).toFixed(0)}% by tokens`
                );
            } else if (gateMetric === "time") {
                selected = pickTopByMetric(cases, (c) => caseWallMs(c), gateTop).map((c) => c.id);
                gateDetailParts.push(`cost=top ${(gateTop * 100).toFixed(0)}% by wall time`);
            } else {
                const tokenRank = rankByMetric(cases, costMetric);
                const timeRank = rankByMetric(cases, (c) => caseWallMs(c));
                const scored = cases.map((c) => ({
                    id: c.id,
                    score: (tokenRank.get(c) ?? 0) + (timeRank.get(c) ?? 0)
                }));
                selected = pickTopByMetric(scored, (c) => c.score, gateTop).map((c) => c.id);
                gateDetailParts.push(
                    hasCostMetrics
                        ? `cost=top ${(gateTop * 100).toFixed(0)}% by cost+time rank`
                        : `cost=top ${(gateTop * 100).toFixed(0)}% by tokens+time rank`
                );
            }
            for (const id of selected) gated.add(id);
            continue;
        }
        if (strategy === "complex") {
            const categories = gateCategories.length > 0 ? gateCategories : DEFAULT_COMPLEX_CATEGORIES;
            const selected = cases
                .filter((resultCase) => {
                    const meta = suiteById.get(resultCase.id);
                    if (!meta) return false;
                    const fileCount = countExpectedFiles(meta);
                    const categoryMatch = categories.includes(meta.category);
                    return fileCount >= gateFilesMin || categoryMatch;
                })
                .map((item) => item.id);
            gateDetailParts.push(formatComplexDetail(gateFilesMin, categories));
            for (const id of selected) gated.add(id);
        }
    }
    const gatedCaseIds = Array.from(gated.values());
    gatedCaseIds.sort();
    const gateDetail = gateDetailParts.join(" | ");

    let kairoMini: ResultsFile | null = null;
    if (gatedCaseIds.length > 0) {
        runSuite({
            repoRoot,
            suitePath,
            mode,
            provider,
            model: modelMini,
            pricing,
            toolMode: "kairo",
            runId: runIds.kairoMini,
            timeoutMs,
            onlyCases: gatedCaseIds.join(","),
            logLevel,
            kairoBudget
        });
        kairoMini = loadResultsByInput(runIds.kairoMini, repoRoot);
    }

    runSuite({
        repoRoot,
        suitePath,
        mode,
        provider,
        model: modelFull,
        pricing,
        toolMode: "baseline",
        runId: runIds.baselineFull,
        timeoutMs,
        onlyCases,
        excludeCases,
        logLevel
    });
    const fullBaseline = loadResultsByInput(runIds.baselineFull, repoRoot);

    const cascadeResults = buildCascadeResults({
        cascadeRunId: runIds.cascade,
        provider,
        modelMini,
        baselineMini,
        kairoMini,
        gatedCaseIds
    });

    const cascadeRunDir = path.join(repoRoot, "benchmarks", "runs", runIds.cascade);
    ensureDir(cascadeRunDir);
    writeJson(path.join(cascadeRunDir, "manifest.json"), {
        run_id: runIds.cascade,
        created_at: new Date().toISOString(),
        mode: "cascade",
        pipeline_mode: "cascade",
        stage_mode: mode,
        suite_id: cascadeResults.suite_id,
        suite_version: cascadeResults.suite_version,
        suite_path: path.relative(repoRoot, suitePath),
        selected_cases: selectedCaseIds,
        model: { provider, id: modelMini },
        case_scope: {
            mode: caseScopeArg,
            detail: caseScopeDetail,
            scoped_cases: caseScopeIds ?? undefined,
            total_cases: suite.cases.length
        },
        gate: { strategy: gateStrategies.join(","), detail: gateDetail, escalated_cases: gatedCaseIds },
        stage_runs: {
            baseline_mini: runIds.baselineMini,
            kairo_mini: gatedCaseIds.length > 0 ? runIds.kairoMini : null,
            baseline_full: runIds.baselineFull
        }
    });
    writeJson(path.join(cascadeRunDir, "results.json"), cascadeResults);

    const reportPath = path.join(repoRoot, "benchmarks", "reports", `agent-cascade-${timestamp}.md`);
    writeCascadeReport(
        reportPath,
        { cascade: cascadeResults as ResultsFile, fullBaseline },
        {
            baselineMiniRunId: runIds.baselineMini,
            kairoMiniRunId: gatedCaseIds.length > 0 ? runIds.kairoMini : null,
            baselineMiniResults: baselineMini,
            kairoMiniResults: kairoMini,
            baselineMiniSummary: baselineMini.summary,
            kairoMiniSummary: kairoMini?.summary ?? null,
            kairoMiniCases: kairoMini?.summary.total_cases ?? 0,
            caseScopeMode: caseScopeArg,
            caseScopeDetail,
            caseScopeIds: caseScopeIds ?? null,
            caseScopeTotalCases: suite.cases.length,
            gateStrategy: gateStrategies.join(","),
            gateDetail,
            gatedCaseIds,
            totalCases: baselineMini.summary.total_cases
        }
    );
    console.log(`✅ Cascade report written: ${path.relative(repoRoot, reportPath)}`);
    console.log(`✅ Cascade results written: ${path.relative(repoRoot, path.join(cascadeRunDir, "results.json"))}`);
}

main();
