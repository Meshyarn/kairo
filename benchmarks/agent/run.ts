import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { resolveRepoRoot } from "../lib/repoRoot.js";

type SuiteMode = "mock" | "replay" | "live";

type Pricing = {
    snapshot?: string;
    currency?: string;
    input_per_1k?: number;
    cached_input_per_1k?: number;
    output_per_1k?: number;
};

type SuiteModel = {
    provider: string;
    id: string;
    params?: Record<string, any>;
};

type Validator =
    | {
          type: "json";
          source?: "final_json" | "final_answer" | "output";
          expect: any;
      }
    | {
          type: "files";
          files: Array<{
              path: string;
              expect_text?: string;
              expect_texts?: string[];
              contains_text?: string;
              contains_texts?: string[];
              excludes_text?: string;
              excludes_texts?: string[];
              expect_sha256?: string;
              expect_json?: any;
          }>;
      }
    | {
          type: "command";
          command: string;
          stdout_contains?: string;
          stderr_contains?: string;
      }
    | {
          type: "patch";
          allow_empty?: boolean;
      };

type BenchmarkCase = {
    id: string;
    category: string;
    description: string;
    fixture:
        | string
        | { type: "git"; ref?: string; paths?: string[] }
        | { type: "worktree"; paths: string[] };
    prompt: string;
    validators: Validator[];
    attempts?: number;
    timeout_ms?: number;
    mock_output?: any;
};

type SuiteConfig = {
    suite_id: string;
    version: string;
    mode?: SuiteMode;
    tool_mode?: "baseline" | "kairo";
    attempts?: number;
    timeout_ms?: number;
    output_dir?: string;
    pricing?: Pricing;
    model: SuiteModel;
    cases: BenchmarkCase[];
};

type LogLevel = "summary" | "progress" | "verbose";

type ResultsCaseSummary = {
    id: string;
    pass_at_1?: boolean;
    passed?: boolean;
};

type ResultsFileSummary = {
    cases: ResultsCaseSummary[];
};

type KairoEnvOverrides = Record<string, string>;

type Usage = {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
};

type ModelOutput = {
    patch_unified_diff: string | null;
    final_answer: string;
    notes: string[];
    final_json?: any;
    usage?: Usage;
};

type AttemptResult = {
    attempt: number;
    passed: boolean;
    duration_ms: number;
    patch_applied: boolean;
    patch_error?: string;
    usage: Usage;
    validators: Array<{ type: string; passed: boolean; details?: any }>;
};

type CaseResult = {
    id: string;
    category: string;
    description: string;
    passed: boolean;
    attempts: number;
    pass_at_1: boolean;
    first_success_attempt?: number;
    metrics: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
        total_tokens: number;
        tokens_to_first_success?: number;
        cost_to_first_success?: number;
        total_cost?: number | null;
        wall_ms_to_first_success?: number;
    };
    attempt_results: AttemptResult[];
};

function getArgValue(argv: string[], name: string): string | null {
    const idx = argv.indexOf(name);
    if (idx === -1) return null;
    const value = argv[idx + 1];
    return value ? String(value) : null;
}

function getArgValues(argv: string[], name: string): string[] {
    const values: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === name && argv[i + 1]) {
            values.push(String(argv[i + 1]));
            i += 1;
        }
    }
    return values;
}

function parseCaseFilter(values: string[]): string[] {
    const entries = values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
    return Array.from(new Set(entries));
}

function parseKairoEnvOverrides(input: string | null | undefined): KairoEnvOverrides {
    if (!input) return {};
    const trimmed = input.trim();
    if (!trimmed) return {};
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
            const entries = Object.entries(parsed).reduce<KairoEnvOverrides>((acc, [key, value]) => {
                acc[key] = String(value);
                return acc;
            }, {});
            return entries;
        }
    } catch {
        // fall through to key=value parsing
    }
    const pairs = trimmed.split(",").map((value) => value.trim()).filter(Boolean);
    const result: KairoEnvOverrides = {};
    for (const pair of pairs) {
        const eqIndex = pair.indexOf("=");
        if (eqIndex === -1) continue;
        const key = pair.slice(0, eqIndex).trim();
        const value = pair.slice(eqIndex + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

function buildKairoBudgetOverrides(level: string | null | undefined): KairoEnvOverrides {
    if (!level) return {};
    const preset = level.toLowerCase();
    if (preset === "low") {
        return {
            KAIRO_EXPLORE_MAX_TOKENS: "600",
            KAIRO_UNDERSTAND_MAX_TOKENS: "1800",
            KAIRO_READ_MAX_TOKENS: "4000",
            KAIRO_MANAGE_MAX_TOKENS: "2500",
            KAIRO_MANAGE_MAX_CHARS: "5000",
            KAIRO_MAX_RESULTS: "12"
        };
    }
    if (preset === "medium") {
        return {
            KAIRO_EXPLORE_MAX_TOKENS: "1200",
            KAIRO_UNDERSTAND_MAX_TOKENS: "3200",
            KAIRO_READ_MAX_TOKENS: "7000",
            KAIRO_MANAGE_MAX_TOKENS: "4500",
            KAIRO_MANAGE_MAX_CHARS: "8000",
            KAIRO_MAX_RESULTS: "20"
        };
    }
    return {};
}

function ensureDir(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
}

function listFilesRecursive(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop()!;
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const abs = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(abs);
            } else if (entry.isFile()) {
                files.push(abs);
            }
        }
    }
    return files;
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

function loadResultsSummary(input: string, repoRoot: string): ResultsFileSummary {
    const filePath = resolveResultsPath(input, repoRoot);
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ResultsFileSummary;
}

function listFailedCases(results: ResultsFileSummary): string[] {
    return results.cases.filter((item) => item.passed === false).map((item) => item.id);
}

function listPassedCases(results: ResultsFileSummary): string[] {
    return results.cases.filter((item) => item.passed === true).map((item) => item.id);
}

function hashFile(filePath: string): string {
    const data = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
}

function computeTaskPackHash(suiteRaw: string, suite: SuiteConfig, repoRoot: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(suiteRaw);
    const entries: string[] = [];
    const fixtureRoots = new Set<string>();
    const resolvedRepoRoot = path.resolve(repoRoot);
    const assertWithinRepoRoot = (sourcePath: string, label: string) => {
        const resolvedSource = path.resolve(sourcePath);
        if (resolvedSource === resolvedRepoRoot) {
            return;
        }
        if (!resolvedSource.startsWith(`${resolvedRepoRoot}${path.sep}`)) {
            throw new Error(`Fixture path must be within repo root (${label}): ${sourcePath}`);
        }
    };
    for (const testCase of suite.cases) {
        if (typeof testCase.fixture === "string") {
            const fixturePath = path.isAbsolute(testCase.fixture)
                ? testCase.fixture
                : path.resolve(repoRoot, testCase.fixture);
            assertWithinRepoRoot(fixturePath, "string");
            fixtureRoots.add(fixturePath);
            continue;
        }
        if (testCase.fixture && typeof testCase.fixture === "object" && testCase.fixture.type === "git") {
            const ref = testCase.fixture.ref ?? "HEAD";
            const resolved = spawnSync("git", ["rev-parse", ref], { cwd: repoRoot, encoding: "utf8" });
            if (resolved.status !== 0) {
                const err = (resolved.stderr || "").toString().trim();
                throw new Error(`git rev-parse failed for ${ref}: ${err || `exit ${resolved.status ?? 1}`}`);
            }
            const commit = String(resolved.stdout || "").trim();
            const paths = testCase.fixture.paths && testCase.fixture.paths.length > 0 ? testCase.fixture.paths : [];
            const lsArgs = ["ls-tree", "-r", "--full-name", commit];
            if (paths.length > 0) {
                lsArgs.push("--", ...paths);
            }
            const tree = spawnSync("git", lsArgs, { cwd: repoRoot, encoding: "utf8" });
            if (tree.status !== 0) {
                const err = (tree.stderr || "").toString().trim();
                throw new Error(`git ls-tree failed for ${ref}: ${err || `exit ${tree.status ?? 1}`}`);
            }
            const lines = String(tree.stdout || "")
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
            if (lines.length === 0) {
                entries.push(`fixture_git:${ref}=${commit} (empty)`);
            } else {
                for (const line of lines) {
                    // format: "<mode> <type> <object>\t<file>"
                    const tab = line.indexOf("\t");
                    if (tab === -1) continue;
                    const meta = line.slice(0, tab).trim().split(/\s+/);
                    const objectHash = meta[2] ?? "";
                    const filePath = line.slice(tab + 1);
                    if (!objectHash || !filePath) continue;
                    entries.push(`${filePath}=${objectHash}`);
                }
            }
            continue;
        }
        if (testCase.fixture && typeof testCase.fixture === "object" && testCase.fixture.type === "worktree") {
            const paths = testCase.fixture.paths ?? [];
            if (!Array.isArray(paths) || paths.length === 0) {
                throw new Error("worktree fixture requires non-empty paths.");
            }
            for (const relPath of paths) {
                const sourcePath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
                assertWithinRepoRoot(sourcePath, "worktree");
                if (!fs.existsSync(sourcePath)) {
                    throw new Error(`worktree fixture path not found: ${relPath}`);
                }
                const stat = fs.statSync(sourcePath);
                if (stat.isDirectory()) {
                    const files = listFilesRecursive(sourcePath);
                    for (const file of files) {
                        const rel = path.relative(repoRoot, file);
                        const digest = hashFile(file);
                        entries.push(`${rel}=${digest}`);
                    }
                } else if (stat.isFile()) {
                    const rel = path.relative(repoRoot, sourcePath);
                    const digest = hashFile(sourcePath);
                    entries.push(`${rel}=${digest}`);
                }
            }
            continue;
        }
        throw new Error("Unsupported fixture type in suite.");
    }
    for (const fixturePath of fixtureRoots) {
        const files = listFilesRecursive(fixturePath);
        for (const file of files) {
            const rel = path.relative(repoRoot, file);
            const digest = hashFile(file);
            entries.push(`${rel}=${digest}`);
        }
    }
    entries.sort();
    hash.update(entries.join("\n"));
    return hash.digest("hex");
}

function normalizeJson(value: any): any {
    if (Array.isArray(value)) {
        return value.map(normalizeJson);
    }
    if (value && typeof value === "object") {
        const sorted: Record<string, any> = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = normalizeJson(value[key]);
        }
        return sorted;
    }
    return value;
}

function jsonEquals(a: any, b: any): boolean {
    return JSON.stringify(normalizeJson(a)) === JSON.stringify(normalizeJson(b));
}

function matchesExpectedText(content: string, expected: string): boolean {
    const normalizedContent = content.replace(/\r\n/g, "\n");
    const normalizedExpect = expected.replace(/\r\n/g, "\n");
    if (normalizedContent === normalizedExpect) return true;
    const matchesTrailingNewline = normalizedContent.endsWith("\n") && normalizedContent.slice(0, -1) === normalizedExpect;
    const matchesMissingNewline =
        normalizedExpect.endsWith("\n") && normalizedExpect.slice(0, -1) === normalizedContent;
    return matchesTrailingNewline || matchesMissingNewline;
}

function buildPrompt(testCase: BenchmarkCase, workspacePath: string, toolMode?: "baseline" | "kairo"): string {
    const contract = [
        "Return ONLY valid JSON. Do not wrap in code fences or extra text.",
        "Minimum schema:",
        "{\"patch_unified_diff\": string|null, \"final_answer\": string, \"notes\": [string]}",
        "If no code changes are needed, set patch_unified_diff to null.",
        "If code changes are needed, patch_unified_diff must be a patch that applies cleanly to the workspace, using ONE of:",
        "- apply_patch format (starts with \"*** Begin Patch\" / ends with \"*** End Patch\")",
        "- unified diff format (includes \"---\" and \"+++\" file headers and \"@@\" hunk ranges)"
    ].join("\n");
    const toolLine =
        toolMode === "baseline"
            ? "Tool mode: baseline (Kairo MCP disabled). Use standard tools only."
            : toolMode === "kairo"
              ? "Tool mode: kairo-only (Kairo MCP enabled; avoid raw file reads or shell tools unless required)."
              : "Tool mode: default.";
    return `${testCase.prompt}\n\n${toolLine}\nWorkspace root: ${workspacePath}\n\n${contract}`;
}

function populateWorkspaceFromFixture(
    fixture: BenchmarkCase["fixture"],
    workspacePath: string,
    repoRoot: string
): { fixtureHint: string } {
    if (typeof fixture === "string") {
        const fixturePath = path.isAbsolute(fixture) ? fixture : path.resolve(repoRoot, fixture);
        const resolvedSource = path.resolve(fixturePath);
        const resolvedRoot = path.resolve(repoRoot);
        if (resolvedSource !== resolvedRoot && !resolvedSource.startsWith(`${resolvedRoot}${path.sep}`)) {
            throw new Error(`Fixture path must be within repo root: ${fixturePath}`);
        }
        fs.cpSync(fixturePath, workspacePath, { recursive: true });
        return { fixtureHint: fixturePath };
    }
    if (fixture && typeof fixture === "object" && fixture.type === "git") {
        const ref = fixture.ref ?? "HEAD";
        const args = ["archive", ref];
        if (fixture.paths && fixture.paths.length > 0) {
            args.push("--", ...fixture.paths);
        }
        const archived = spawnSync("git", args, {
            cwd: repoRoot,
            encoding: "buffer",
            maxBuffer: 64 * 1024 * 1024
        });
        if (archived.status !== 0 || !archived.stdout) {
            const stderr = (archived.stderr || Buffer.from("")).toString("utf8").trim();
            throw new Error(`git archive failed: ${stderr || `exit ${archived.status ?? 1}`}`);
        }
        const extracted = spawnSync("tar", ["-x", "-f", "-"], {
            cwd: workspacePath,
            input: archived.stdout,
            encoding: "buffer",
            maxBuffer: 64 * 1024 * 1024
        });
        if (extracted.status !== 0) {
            const stderr = (extracted.stderr || Buffer.from("")).toString("utf8").trim();
            throw new Error(`tar extract failed: ${stderr || `exit ${extracted.status ?? 1}`}`);
        }
        return {
            fixtureHint: `git:${ref}${fixture.paths && fixture.paths.length > 0 ? ` (${fixture.paths.join(", ")})` : ""}`
        };
    }
    if (fixture && typeof fixture === "object" && fixture.type === "worktree") {
        const paths = fixture.paths ?? [];
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error("worktree fixture requires non-empty paths.");
        }
        for (const relPath of paths) {
            const sourcePath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
            const resolvedSource = path.resolve(sourcePath);
            const resolvedRoot = path.resolve(repoRoot);
            if (resolvedSource !== resolvedRoot && !resolvedSource.startsWith(`${resolvedRoot}${path.sep}`)) {
                throw new Error(`worktree fixture path must be within repo root: ${relPath}`);
            }
            if (!fs.existsSync(sourcePath)) {
                throw new Error(`worktree fixture path not found: ${relPath}`);
            }
            const stat = fs.statSync(sourcePath);
            if (stat.isDirectory()) {
                const files = listFilesRecursive(sourcePath);
                for (const file of files) {
                    const relativeFilePath = path.relative(repoRoot, file);
                    const targetPath = path.join(workspacePath, relativeFilePath);
                    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                    fs.copyFileSync(file, targetPath);
                }
                continue;
            }
            const relativeFilePath = path.relative(repoRoot, sourcePath);
            const targetPath = path.join(workspacePath, relativeFilePath);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
        }
        return { fixtureHint: `worktree (${paths.join(", ")})` };
    }
    throw new Error("Unsupported fixture type.");
}

async function runLiveModel(
    prompt: string,
    timeoutMs: number,
    workspacePath: string,
    modelId?: string,
    toolMode?: "baseline" | "kairo",
    benchHome?: string,
    logDir?: string,
    kairoEnvOverrides?: KairoEnvOverrides
): Promise<any> {
    const command = process.env.KAIRO_AGENT_MODEL_CMD;
    if (!command) {
        throw new Error("KAIRO_AGENT_MODEL_CMD is not set. Provide a command to run the model.");
    }
    return new Promise((resolve, reject) => {
        const child = spawn(command, {
            shell: true,
            detached: true,
            stdio: ["pipe", "pipe", "pipe"],
            env: {
                ...process.env,
                KAIRO_BENCH_WORKSPACE: workspacePath,
                KAIRO_BENCH_MODEL: modelId ?? "",
                KAIRO_BENCH_TOOL_MODE: toolMode ?? "",
                KAIRO_BENCH_HOME: benchHome ?? "",
                KAIRO_BENCH_LOG_DIR: logDir ?? "",
                CODEX_TIMEOUT_MS: String(timeoutMs),
                KAIRO_BENCH_KAIRO_ENV:
                    kairoEnvOverrides && Object.keys(kairoEnvOverrides).length > 0
                        ? JSON.stringify(kairoEnvOverrides)
                        : ""
            }
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let settled = false;
        const killTree = () => {
            try {
                if (child.pid) {
                    process.kill(-child.pid, "SIGKILL");
                } else {
                    child.kill("SIGKILL");
                }
            } catch {
                try {
                    child.kill("SIGKILL");
                } catch {
                    // ignore
                }
            }
        };
        const settleError = (error: Error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        const settleSuccess = (value: any) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const timer = setTimeout(() => {
            killTree();
            settleError(new Error(`Model command timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
            stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        });
        child.stderr.on("data", (chunk) => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            settleError(err instanceof Error ? err : new Error(String(err)));
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
            const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
            if (code !== 0) {
                return settleError(new Error(`Model command failed (exit ${code}): ${stderr || stdout}`));
            }
            try {
                settleSuccess(JSON.parse(stdout));
            } catch (err) {
                settleError(new Error(`Model output is not valid JSON: ${(err as Error).message}`));
            }
        });
        child.stdin.write(prompt);
        child.stdin.end();
    });
}

function validateModelOutput(output: any): ModelOutput {
    if (!output || typeof output !== "object") {
        throw new Error("Model output must be a JSON object.");
    }
    const patch = output.patch_unified_diff;
    const finalAnswer = output.final_answer;
    const notes = output.notes;
    if (!(patch === null || typeof patch === "string")) {
        throw new Error("patch_unified_diff must be string or null.");
    }
    if (typeof finalAnswer !== "string") {
        throw new Error("final_answer must be a string.");
    }
    if (!Array.isArray(notes)) {
        throw new Error("notes must be an array.");
    }
    return output as ModelOutput;
}

function detectPatchStripLevel(patch: string): number {
    if (/^---\s+a\//m.test(patch) || /^\+\+\+\s+b\//m.test(patch)) {
        return 1;
    }
    return 0;
}

type ApplyPatchOp =
    | { type: "update"; filePath: string; hunks: string[][] }
    | { type: "add"; filePath: string; contentLines: string[] }
    | { type: "delete"; filePath: string };

function normalizePatchPath(rawPath: string): string {
    let trimmed = rawPath.trim();
    const tabIndex = trimmed.indexOf("\t");
    if (tabIndex !== -1) {
        trimmed = trimmed.slice(0, tabIndex).trim();
    }
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex !== -1) {
        trimmed = trimmed.slice(0, spaceIndex).trim();
    }
    if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
        return trimmed.slice(2);
    }
    return trimmed;
}

function parseApplyPatchFormat(patchText: string): ApplyPatchOp[] | null {
    const trimmed = patchText.trimStart();
    if (!trimmed.startsWith("*** Begin Patch")) {
        return null;
    }
    const ops: ApplyPatchOp[] = [];
    const lines = patchText.split(/\r?\n/);
    let currentOp: ApplyPatchOp | null = null;
    let currentHunk: string[] = [];
    const flushHunk = () => {
        if (currentOp && currentOp.type === "update" && currentHunk.length > 0) {
            currentOp.hunks.push([...currentHunk]);
            currentHunk = [];
        }
    };
    const flushOp = () => {
        if (currentOp) {
            flushHunk();
            ops.push(currentOp);
        }
        currentOp = null;
    };
    for (const line of lines) {
        if (line.startsWith("*** Begin Patch")) {
            continue;
        }
        if (line.startsWith("*** End Patch")) {
            flushOp();
            break;
        }
        if (line.startsWith("*** End of File")) {
            continue;
        }
        if (line.startsWith("*** Update File:")) {
            flushOp();
            currentOp = { type: "update", filePath: line.replace("*** Update File:", "").trim(), hunks: [] };
            continue;
        }
        if (line.startsWith("*** Add File:")) {
            flushOp();
            currentOp = { type: "add", filePath: line.replace("*** Add File:", "").trim(), contentLines: [] };
            continue;
        }
        if (line.startsWith("*** Delete File:")) {
            flushOp();
            currentOp = { type: "delete", filePath: line.replace("*** Delete File:", "").trim() };
            flushOp();
            continue;
        }
        if (line.startsWith("*** Move to:")) {
            continue;
        }
        if (line.startsWith("@@")) {
            flushHunk();
            continue;
        }
        if (currentOp?.type === "add") {
            if (line.startsWith("+")) {
                currentOp.contentLines.push(line.slice(1));
            } else if (line.length === 0) {
                currentOp.contentLines.push("");
            }
            continue;
        }
        if (currentOp?.type === "update") {
            currentHunk.push(line);
        }
    }
    flushOp();
    return ops;
}

function parseGitDiffWithoutRanges(patchText: string): ApplyPatchOp[] | null {
    const hasFrom = patchText.includes("\n--- ") || patchText.startsWith("--- ");
    const hasTo = patchText.includes("\n+++ ") || patchText.startsWith("+++ ");
    if (!hasFrom || !hasTo) return null;
    const lines = patchText.split(/\r?\n/);
    const ops: ApplyPatchOp[] = [];
    let currentOp: ApplyPatchOp | null = null;
    let currentHunk: string[] = [];
    let inHunk = false;
    let newFile = false;
    let deleteFile = false;
    let pendingPath: string | null = null;

    const flushHunk = () => {
        if (currentOp && currentOp.type === "update" && currentHunk.length > 0) {
            currentOp.hunks.push([...currentHunk]);
            currentHunk = [];
        }
    };
    const flushOp = () => {
        if (currentOp) {
            flushHunk();
            ops.push(currentOp);
        }
        currentOp = null;
        currentHunk = [];
        inHunk = false;
        newFile = false;
        deleteFile = false;
        pendingPath = null;
    };

    for (const line of lines) {
        if (line.startsWith("diff --git ")) {
            flushOp();
            continue;
        }
        if (line.startsWith("new file mode")) {
            newFile = true;
            continue;
        }
        if (line.startsWith("deleted file mode")) {
            deleteFile = true;
            continue;
        }
        if (line.startsWith("--- ")) {
            if (currentOp) {
                flushOp();
            }
            const fromPath = normalizePatchPath(line.replace(/^---\s+/, ""));
            if (fromPath === "/dev/null") {
                newFile = true;
            }
            continue;
        }
        if (line.startsWith("+++ ")) {
            const toPath = normalizePatchPath(line.replace(/^\+\+\+\s+/, ""));
            if (toPath === "/dev/null") {
                deleteFile = true;
                continue;
            }
            pendingPath = toPath;
            if (newFile) {
                currentOp = { type: "add", filePath: pendingPath, contentLines: [] };
            } else if (deleteFile) {
                currentOp = { type: "delete", filePath: pendingPath };
                flushOp();
            } else {
                currentOp = { type: "update", filePath: pendingPath, hunks: [] };
            }
            continue;
        }
        if (line.startsWith("@@")) {
            if (currentOp && currentOp.type === "update") {
                flushHunk();
                inHunk = true;
            }
            continue;
        }
        if (!currentOp) continue;
        if (currentOp.type === "add") {
            if (line.startsWith("+") && !line.startsWith("+++")) {
                currentOp.contentLines.push(line.slice(1));
            } else if (line === "") {
                currentOp.contentLines.push("");
            }
            continue;
        }
        if (currentOp.type === "update") {
            if (line.startsWith("\\ No newline at end of file")) {
                continue;
            }
            if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "") {
                if (!inHunk) {
                    inHunk = true;
                }
                currentHunk.push(line);
            }
        }
    }
    flushOp();
    return ops.length > 0 ? ops : null;
}

function applyApplyPatchOps(ops: ApplyPatchOp[], workspacePath: string): { ok: boolean; error?: string } {
    try {
        for (const op of ops) {
            const targetPath = path.join(workspacePath, op.filePath);
            if (op.type === "delete") {
                if (fs.existsSync(targetPath)) {
                    fs.unlinkSync(targetPath);
                }
                continue;
            }
            if (op.type === "add") {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                const content = op.contentLines.join("\n") + "\n";
                fs.writeFileSync(targetPath, content);
                continue;
            }
            if (op.type === "update") {
                if (!fs.existsSync(targetPath)) {
                    return { ok: false, error: `File not found: ${op.filePath}` };
                }
                let content = fs.readFileSync(targetPath, "utf8");
                for (const hunk of op.hunks) {
                    const oldLines: string[] = [];
                    const newLines: string[] = [];
                    for (const hunkLine of hunk) {
                        if (hunkLine.startsWith("-")) {
                            oldLines.push(hunkLine.slice(1));
                        } else if (hunkLine.startsWith("+")) {
                            newLines.push(hunkLine.slice(1));
                        } else if (hunkLine.startsWith(" ")) {
                            const text = hunkLine.slice(1);
                            oldLines.push(text);
                            newLines.push(text);
                        } else {
                            oldLines.push(hunkLine);
                            newLines.push(hunkLine);
                        }
                    }
                    const oldText = oldLines.join("\n");
                    const newText = newLines.join("\n");
                    let index = content.indexOf(oldText);
                    if (index === -1) {
                        // Tolerate CRLF vs LF mismatches (common in fixtures exported from git on Windows).
                        const hadCrlf = content.includes("\r\n");
                        const normalizedContent = content.replace(/\r\n/g, "\n");
                        const normalizedIndex = normalizedContent.indexOf(oldText);
                        if (normalizedIndex === -1) {
                            return { ok: false, error: `Hunk not found in ${op.filePath}` };
                        }
                        const replaced = normalizedContent.replace(oldText, newText);
                        content = hadCrlf ? replaced.replace(/\n/g, "\r\n") : replaced;
                        continue;
                    }
                    content = content.replace(oldText, newText);
                }
                fs.writeFileSync(targetPath, content);
            }
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function applyPatch(patchText: string, workspacePath: string): { ok: boolean; error?: string } {
    const applyPatchOps = parseApplyPatchFormat(patchText);
    if (applyPatchOps) {
        return applyApplyPatchOps(applyPatchOps, workspacePath);
    }
    const stripLevel = detectPatchStripLevel(patchText);
    const result = spawnSync("patch", [`-p${stripLevel}`, "--forward"], {
        cwd: workspacePath,
        input: patchText,
        encoding: "utf8"
    });
    if (result.error) {
        const gitOps = parseGitDiffWithoutRanges(patchText);
        if (gitOps) {
            return applyApplyPatchOps(gitOps, workspacePath);
        }
        return { ok: false, error: result.error.message };
    }
    if (result.status !== 0) {
        const gitOps = parseGitDiffWithoutRanges(patchText);
        if (gitOps) {
            const applied = applyApplyPatchOps(gitOps, workspacePath);
            if (applied.ok) {
                return applied;
            }
            return { ok: false, error: applied.error };
        }
        return { ok: false, error: (result.stderr || result.stdout || "").toString() };
    }
    return { ok: true };
}

async function runValidators(
    validators: Validator[],
    output: ModelOutput,
    workspacePath: string,
    patchApplied: boolean,
    timeoutMs: number
): Promise<Array<{ type: string; passed: boolean; details?: any }>> {
    const results: Array<{ type: string; passed: boolean; details?: any }> = [];
    for (const validator of validators) {
        if (validator.type === "patch") {
            const allowEmpty = validator.allow_empty === true;
            const passed = allowEmpty ? true : patchApplied;
            results.push({ type: "patch", passed, details: { patchApplied } });
            continue;
        }
        if (validator.type === "json") {
            const source = validator.source ?? "output";
            let candidate: any;
            if (source === "final_json") {
                candidate = output.final_json;
            } else if (source === "final_answer") {
                candidate = output.final_answer;
            } else {
                candidate = output;
            }
            const expected = validator.expect;
            let parsedCandidate = candidate;
            if (typeof candidate === "string" && expected && typeof expected === "object") {
                try {
                    parsedCandidate = JSON.parse(candidate);
                } catch {
                    results.push({ type: "json", passed: false, details: { error: "final_answer is not JSON" } });
                    continue;
                }
            }
            const passed = jsonEquals(parsedCandidate, expected);
            results.push({ type: "json", passed, details: { source } });
            continue;
        }
        if (validator.type === "files") {
            const details: any[] = [];
            let passed = true;
            for (const file of validator.files) {
                const filePath = path.join(workspacePath, file.path);
                if (!fs.existsSync(filePath)) {
                    passed = false;
                    details.push({ path: file.path, error: "missing" });
                    continue;
                }
                const content = fs.readFileSync(filePath, "utf8");
                const expectedCandidates =
                    file.expect_texts && file.expect_texts.length > 0
                        ? file.expect_texts
                        : file.expect_text !== undefined
                          ? [file.expect_text]
                          : [];
                if (expectedCandidates.length > 0) {
                    const matched = expectedCandidates.some((expected) => matchesExpectedText(content, expected));
                    if (!matched) {
                        passed = false;
                        details.push({ path: file.path, error: "text_mismatch" });
                    }
                }
                if (file.contains_text !== undefined) {
                    if (!content.includes(file.contains_text)) {
                        passed = false;
                        details.push({ path: file.path, error: "missing_contains", needle: file.contains_text });
                    }
                }
                if (file.contains_texts && file.contains_texts.length > 0) {
                    for (const needle of file.contains_texts) {
                        if (!content.includes(needle)) {
                            passed = false;
                            details.push({ path: file.path, error: "missing_contains", needle });
                        }
                    }
                }
                if (file.excludes_text !== undefined) {
                    if (content.includes(file.excludes_text)) {
                        passed = false;
                        details.push({ path: file.path, error: "unexpected_contains", needle: file.excludes_text });
                    }
                }
                if (file.excludes_texts && file.excludes_texts.length > 0) {
                    for (const needle of file.excludes_texts) {
                        if (content.includes(needle)) {
                            passed = false;
                            details.push({ path: file.path, error: "unexpected_contains", needle });
                        }
                    }
                }
                if (file.expect_json !== undefined) {
                    try {
                        const parsed = JSON.parse(content);
                        if (!jsonEquals(parsed, file.expect_json)) {
                            passed = false;
                            details.push({ path: file.path, error: "json_mismatch" });
                        }
                    } catch {
                        passed = false;
                        details.push({ path: file.path, error: "json_parse_error" });
                    }
                }
                if (file.expect_sha256 !== undefined) {
                    const digest = crypto.createHash("sha256").update(content).digest("hex");
                    if (digest !== file.expect_sha256) {
                        passed = false;
                        details.push({ path: file.path, error: "hash_mismatch" });
                    }
                }
            }
            results.push({ type: "files", passed, details });
            continue;
        }
        if (validator.type === "command") {
            const cmdResult = spawnSync(validator.command, {
                cwd: workspacePath,
                shell: true,
                encoding: "utf8",
                timeout: timeoutMs
            });
            let passed = cmdResult.status === 0;
            if (validator.stdout_contains && !String(cmdResult.stdout).includes(validator.stdout_contains)) {
                passed = false;
            }
            if (validator.stderr_contains && !String(cmdResult.stderr).includes(validator.stderr_contains)) {
                passed = false;
            }
            results.push({
                type: "command",
                passed,
                details: {
                    status: cmdResult.status,
                    stdout: cmdResult.stdout,
                    stderr: cmdResult.stderr
                }
            });
            continue;
        }
        results.push({ type: (validator as any).type ?? "unknown", passed: false, details: { error: "unknown validator" } });
    }
    return results;
}

type PricingTable = {
    snapshot?: string;
    currency?: string;
    default?: Pricing;
    models?: Record<string, Pricing>;
};

function isPricingEnabled(pricing: Pricing | null | undefined): pricing is Pricing {
    if (!pricing) return false;
    return (
        (Number(pricing.input_per_1k) || 0) > 0 ||
        (Number(pricing.cached_input_per_1k) || 0) > 0 ||
        (Number(pricing.output_per_1k) || 0) > 0
    );
}

function loadJsonFromArg(input: string, repoRoot: string): any {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return JSON.parse(trimmed);
    }
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(repoRoot, trimmed);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Pricing file not found: ${resolved}`);
    }
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function resolvePricing(
    pricingArg: string | null | undefined,
    suitePricing: Pricing | undefined,
    model: SuiteModel,
    repoRoot: string
): Pricing | null {
    let selected: Pricing | undefined = suitePricing;
    if (pricingArg) {
        const raw = loadJsonFromArg(pricingArg, repoRoot);
        if (raw && typeof raw === "object" && raw.models && typeof raw.models === "object") {
            const table = raw as PricingTable;
            const key = `${model.provider}/${model.id}`;
            selected = table.models?.[key] ?? table.models?.[model.id] ?? table.models?.default ?? table.default ?? undefined;
            if (selected) {
                selected = { snapshot: table.snapshot, currency: table.currency, ...selected };
            } else {
                selected = undefined;
            }
        } else if (raw && typeof raw === "object") {
            selected = raw as Pricing;
        } else {
            selected = undefined;
        }
    }
    return isPricingEnabled(selected) ? selected : null;
}

function computeCost(usage: Usage, pricing?: Pricing | null): number | undefined {
    if (!pricing || !isPricingEnabled(pricing)) return undefined;
    const input = usage.input_tokens ?? 0;
    const cachedInput = usage.cached_input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const billableInput = Math.max(input - cachedInput, 0);
    const inputRate = pricing.input_per_1k ?? 0;
    const cachedInputRate = pricing.cached_input_per_1k ?? inputRate;
    const outputRate = pricing.output_per_1k ?? 0;
    const inputCost = inputRate > 0 ? (billableInput / 1000) * inputRate : 0;
    const cachedCost = cachedInputRate > 0 ? (cachedInput / 1000) * cachedInputRate : 0;
    const outputCost = outputRate > 0 ? (output / 1000) * outputRate : 0;
    return inputCost + cachedCost + outputCost;
}

function writeJson(filePath: string, value: any) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function generateRunId(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `agent-${stamp}`;
}

function truncate(value: string, max = 200): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max - 3)}...`;
}

function parseLogLevel(value: string | null | undefined): LogLevel {
    if (value === "summary" || value === "progress" || value === "verbose") {
        return value;
    }
    return "progress";
}

async function main() {
    const argv = process.argv.slice(2);
    const suiteArg = getArgValue(argv, "--suite") ?? "benchmarks/agent/suite.example.json";
    const modeArg = getArgValue(argv, "--mode") as SuiteMode | null;
    const replayFrom = getArgValue(argv, "--replay-from");
    const runId = getArgValue(argv, "--run-id") ?? generateRunId();

    const repoRoot = resolveRepoRoot({ cwd: process.cwd(), fileHint: fileURLToPath(import.meta.url) });
    const suitePath = path.isAbsolute(suiteArg) ? suiteArg : path.resolve(repoRoot, suiteArg);
    if (!fs.existsSync(suitePath)) {
        console.error(`Suite not found: ${suitePath}`);
        process.exit(1);
    }

    const suiteRaw = fs.readFileSync(suitePath, "utf8");
    const suite: SuiteConfig = JSON.parse(suiteRaw);
    const onlyCasesExplicit = parseCaseFilter([getArgValue(argv, "--only") ?? "", ...getArgValues(argv, "--case")]);
    const excludeCases = parseCaseFilter([getArgValue(argv, "--exclude") ?? "", ...getArgValues(argv, "--skip")]);
    const onlyFailedFrom = getArgValue(argv, "--only-failed-from");
    const onlyPassedFrom = getArgValue(argv, "--only-passed-from");
    if (onlyFailedFrom && onlyPassedFrom) {
        console.error("Use only one of --only-failed-from or --only-passed-from.");
        process.exit(1);
    }
    let onlyCases = onlyCasesExplicit;
    if (onlyFailedFrom) {
        const failedCases = listFailedCases(loadResultsSummary(onlyFailedFrom, repoRoot));
        onlyCases = onlyCases.length > 0 ? onlyCases.filter((id) => failedCases.includes(id)) : failedCases;
    }
    if (onlyPassedFrom) {
        const passedCases = listPassedCases(loadResultsSummary(onlyPassedFrom, repoRoot));
        onlyCases = onlyCases.length > 0 ? onlyCases.filter((id) => passedCases.includes(id)) : passedCases;
    }
    if (onlyCases.length > 0) {
        suite.cases = suite.cases.filter((testCase) => onlyCases.includes(testCase.id));
    }
    if (excludeCases.length > 0) {
        suite.cases = suite.cases.filter((testCase) => !excludeCases.includes(testCase.id));
    }
    if (suite.cases.length === 0) {
        console.error("No cases selected. Check --only/--case/--exclude/--skip filters.");
        process.exit(1);
    }
    const mode: SuiteMode = modeArg ?? suite.mode ?? "mock";
    const toolMode = (getArgValue(argv, "--tool-mode") as "baseline" | "kairo" | null) ?? suite.tool_mode;
    const modelOverride = getArgValue(argv, "--model");
    const providerOverride = getArgValue(argv, "--provider");
    const effectiveModel: SuiteModel = {
        ...suite.model,
        id: modelOverride ?? suite.model.id,
        provider: providerOverride ?? suite.model.provider
    };
    const effectivePricing = resolvePricing(
        getArgValue(argv, "--pricing") ?? process.env.KAIRO_BENCH_PRICING,
        suite.pricing,
        effectiveModel,
        repoRoot
    );
    const attemptsArg = getArgValue(argv, "--attempts");
    const attemptsOverride = attemptsArg ? Number(attemptsArg) : undefined;
    const runAllAttempts = argv.includes("--run-all-attempts");
    const attemptsDefault = attemptsOverride ?? suite.attempts ?? 1;
    const timeoutOverride = getArgValue(argv, "--timeout-ms");
    const timeoutMs = timeoutOverride ? Number(timeoutOverride) : suite.timeout_ms ?? 60000;
    const outputDir = suite.output_dir ? path.resolve(repoRoot, suite.output_dir) : path.join(repoRoot, "benchmarks", "runs");
    const logLevel = parseLogLevel(getArgValue(argv, "--log-level") ?? process.env.KAIRO_BENCH_LOG_LEVEL);
    const kairoBudget = getArgValue(argv, "--kairo-budget");
    const kairoEnvArg = getArgValue(argv, "--kairo-env");
    const kairoOverrides = {
        ...parseKairoEnvOverrides(process.env.KAIRO_BENCH_KAIRO_ENV),
        ...parseKairoEnvOverrides(kairoEnvArg),
        ...buildKairoBudgetOverrides(kairoBudget)
    };
    const logRank: Record<LogLevel, number> = { summary: 0, progress: 1, verbose: 2 };
    const logAt = (level: LogLevel, message: string) => {
        if (logRank[logLevel] >= logRank[level]) {
            console.log(message);
        }
    };

    const runDir = path.join(outputDir, runId);
    const transcriptsDir = path.join(runDir, "transcripts");
    const patchesDir = path.join(runDir, "patches");
    const logsDir = path.join(runDir, "validator-logs");
    const runnerLogsDir = path.join(runDir, "runner-logs");
    const benchHome = path.join(runDir, "codex-home");
    ensureDir(transcriptsDir);
    ensureDir(patchesDir);
    ensureDir(logsDir);
    ensureDir(runnerLogsDir);
    ensureDir(benchHome);

    const taskPackHash = computeTaskPackHash(suiteRaw, suite, repoRoot);

    const manifest = {
        run_id: runId,
        suite_id: suite.suite_id,
        suite_version: suite.version,
        suite_path: path.relative(repoRoot, suitePath),
        task_pack_hash: taskPackHash,
        mode,
        tool_mode: toolMode ?? null,
        model: effectiveModel,
        pricing: effectivePricing,
        started_at: new Date().toISOString(),
        node_version: process.version,
        platform: process.platform,
        arch: process.arch
    };

    const caseResults: CaseResult[] = [];
    const suiteStart = performance.now();

    logAt("progress", `▶️ Run ${runId} | mode=${mode} | tool=${toolMode ?? "default"} | model=${effectiveModel.provider}/${effectiveModel.id}`);
    logAt(
        "progress",
        `▶️ Cases: ${suite.cases.length} | attempts=${attemptsDefault} | timeout=${timeoutMs}ms | log=${logLevel}`
    );
    if (Object.keys(kairoOverrides).length > 0) {
        logAt("progress", `▶️ Kairo overrides: ${Object.keys(kairoOverrides).length} env values`);
    }

    for (let caseIndex = 0; caseIndex < suite.cases.length; caseIndex += 1) {
        const testCase = suite.cases[caseIndex];
        const caseTimeoutMs = testCase.timeout_ms ?? timeoutMs;
        logAt(
            "progress",
            `\n▶️ [${caseIndex + 1}/${suite.cases.length}] ${testCase.id} (${testCase.category})`
        );
        const caseAttempts = attemptsOverride ?? testCase.attempts ?? attemptsDefault;
        const attemptResults: AttemptResult[] = [];
        let casePassed = false;
        let firstSuccessAttempt: number | undefined;
        let inputTokensToFirstSuccess = 0;
        let cachedInputTokensToFirstSuccess = 0;
        let outputTokensToFirstSuccess = 0;
        let wallToFirstSuccess = 0;
        let cumulativeInputTokens = 0;
        let cumulativeCachedInputTokens = 0;
        let cumulativeOutputTokens = 0;
        let cumulativeWall = 0;

        for (let attempt = 1; attempt <= caseAttempts; attempt++) {
            logAt("progress", `  • Attempt ${attempt}/${caseAttempts}`);
            const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-agent-"));
            const { fixtureHint } = populateWorkspaceFromFixture(testCase.fixture, workspacePath, repoRoot);
            logAt("verbose", `    workspace: ${workspacePath}`);
            logAt("verbose", `    fixture: ${fixtureHint}`);

            const prompt = buildPrompt(testCase, workspacePath, toolMode);
            logAt("verbose", `    prompt length: ${prompt.length}`);
            const attemptStart = performance.now();
            let output: ModelOutput;
            let outputRaw: any;

            try {
                if (mode === "mock") {
                    if (!testCase.mock_output) {
                        throw new Error(`mock_output missing for case ${testCase.id}`);
                    }
                    outputRaw = testCase.mock_output;
                } else if (mode === "replay") {
                    if (!replayFrom) {
                        throw new Error("Replay mode requires --replay-from <run-id>");
                    }
                    const replayPath = path.join(outputDir, replayFrom, "transcripts", `${testCase.id}-attempt${attempt}.json`);
                    if (!fs.existsSync(replayPath)) {
                        throw new Error(`Replay transcript not found: ${replayPath}`);
                    }
                    const replay = JSON.parse(fs.readFileSync(replayPath, "utf8"));
                    outputRaw = replay.output ?? replay;
                } else {
                    outputRaw = await runLiveModel(
                        prompt,
                        caseTimeoutMs,
                        workspacePath,
                        effectiveModel.id,
                        toolMode,
                        benchHome,
                        runnerLogsDir,
                        kairoOverrides
                    );
                }
                output = validateModelOutput(outputRaw);
            } catch (error) {
                const duration = performance.now() - attemptStart;
                attemptResults.push({
                    attempt,
                    passed: false,
                    duration_ms: Math.round(duration),
                    patch_applied: false,
                    patch_error: (error as Error).message,
                    usage: {}
                });
                cumulativeWall += duration;
                logAt("progress", `    ❌ Failed: ${truncate((error as Error).message)}`);
                logAt("verbose", `    error: ${truncate((error as Error).message, 1200)}`);
                writeJson(path.join(transcriptsDir, `${testCase.id}-attempt${attempt}.json`), {
                    id: testCase.id,
                    attempt,
                    prompt,
                    output: outputRaw ?? null,
                    error: (error as Error).message
                });
                logAt("verbose", `    transcript: ${path.join(transcriptsDir, `${testCase.id}-attempt${attempt}.json`)}`);
                continue;
            }

            const usage = output.usage ?? {};
            logAt(
                "verbose",
                `    output: patch=${output.patch_unified_diff ? `${output.patch_unified_diff.length} chars` : "null"} notes=${output.notes?.length ?? 0}`
            );
            let patchApplied = false;
            let patchError: string | undefined;
            if (output.patch_unified_diff) {
                const patchPath = path.join(patchesDir, `${testCase.id}-attempt${attempt}.diff`);
                fs.writeFileSync(patchPath, output.patch_unified_diff);
                const patchResult = applyPatch(output.patch_unified_diff, workspacePath);
                patchApplied = patchResult.ok;
                patchError = patchResult.error;
                logAt("verbose", `    patch: ${patchApplied ? "applied" : `failed (${truncate(patchError ?? "", 200)})`}`);
                logAt("verbose", `    patch file: ${patchPath}`);
            }

            const validatorResults = await runValidators(
                testCase.validators,
                output,
                workspacePath,
                patchApplied,
                caseTimeoutMs
            );
            if (logRank[logLevel] >= logRank.verbose) {
                for (const result of validatorResults) {
                    const detail = result.details ? truncate(JSON.stringify(result.details), 300) : "";
                    logAt("verbose", `    validator ${result.type}: ${result.passed ? "ok" : "fail"} ${detail}`);
                }
            }
            let passed = validatorResults.every((v) => v.passed);
            if (!passed) {
                const patchResult = validatorResults.find((v) => v.type === "patch");
                const nonPatchFailures = validatorResults.filter((v) => v.type !== "patch" && !v.passed);
                if (patchResult && !patchResult.passed && nonPatchFailures.length === 0) {
                    patchResult.passed = true;
                    patchResult.details = { ...patchResult.details, override: "files_validated" };
                    passed = true;
                }
            }
            const duration = performance.now() - attemptStart;

            attemptResults.push({
                attempt,
                passed,
                duration_ms: Math.round(duration),
                patch_applied: patchApplied,
                patch_error: patchError,
                usage
            });

            cumulativeInputTokens += usage.input_tokens ?? 0;
            cumulativeCachedInputTokens += usage.cached_input_tokens ?? 0;
            cumulativeOutputTokens += usage.output_tokens ?? 0;
            cumulativeWall += duration;

            writeJson(path.join(transcriptsDir, `${testCase.id}-attempt${attempt}.json`), {
                id: testCase.id,
                attempt,
                prompt,
                output,
                usage,
                patch_applied: patchApplied,
                patch_error: patchError,
                validator_results: validatorResults
            });

            if (passed) {
                logAt(
                    "progress",
                    `    ✅ Passed in ${Math.round(duration)}ms (tokens: in=${usage.input_tokens ?? 0} out=${usage.output_tokens ?? 0})`
                );
            } else {
                const failedValidators = validatorResults.filter((v) => !v.passed).map((v) => v.type).join(", ");
                logAt(
                    "progress",
                    `    ❌ Failed (${failedValidators || "unknown"}) in ${Math.round(duration)}ms`
                );
            }

            if (passed && !casePassed) {
                casePassed = true;
                firstSuccessAttempt = attempt;
                inputTokensToFirstSuccess = cumulativeInputTokens;
                cachedInputTokensToFirstSuccess = cumulativeCachedInputTokens;
                outputTokensToFirstSuccess = cumulativeOutputTokens;
                wallToFirstSuccess = cumulativeWall;
            }

            if (passed && !runAllAttempts) {
                break;
            }
        }

        const totalInputTokens = attemptResults.reduce((sum, r) => sum + (r.usage.input_tokens ?? 0), 0);
        const totalCachedInputTokens = attemptResults.reduce((sum, r) => sum + (r.usage.cached_input_tokens ?? 0), 0);
        const totalOutputTokens = attemptResults.reduce((sum, r) => sum + (r.usage.output_tokens ?? 0), 0);
        const totalTokens = totalInputTokens + totalOutputTokens;
        const costToFirstSuccess = casePassed
            ? computeCost(
                  {
                      input_tokens: inputTokensToFirstSuccess,
                      cached_input_tokens: cachedInputTokensToFirstSuccess,
                      output_tokens: outputTokensToFirstSuccess
                  },
                  effectivePricing
              )
            : undefined;
        const totalCost = computeCost(
            { input_tokens: totalInputTokens, cached_input_tokens: totalCachedInputTokens, output_tokens: totalOutputTokens },
            effectivePricing
        );

        caseResults.push({
            id: testCase.id,
            category: testCase.category,
            description: testCase.description,
            passed: casePassed,
            attempts: attemptResults.length,
            pass_at_1: attemptResults[0]?.passed ?? false,
            first_success_attempt: firstSuccessAttempt,
            metrics: {
                input_tokens: totalInputTokens,
                cached_input_tokens: totalCachedInputTokens,
                output_tokens: totalOutputTokens,
                total_tokens: totalTokens,
                tokens_to_first_success: casePassed
                    ? inputTokensToFirstSuccess + outputTokensToFirstSuccess
                    : undefined,
                cost_to_first_success: casePassed ? costToFirstSuccess : undefined,
                total_cost: totalCost ?? null,
                wall_ms_to_first_success: casePassed ? Math.round(wallToFirstSuccess) : undefined
            },
            attempt_results: attemptResults
        });
    }

    const suiteDuration = performance.now() - suiteStart;
    const totalCases = caseResults.length;
    const passedAt1 = caseResults.filter((r) => r.pass_at_1).length;
    const passedAny = caseResults.filter((r) => r.passed).length;
    const totalInputTokens = caseResults.reduce((sum, r) => sum + r.metrics.input_tokens, 0);
    const totalCachedInputTokens = caseResults.reduce((sum, r) => sum + r.metrics.cached_input_tokens, 0);
    const totalOutputTokens = caseResults.reduce((sum, r) => sum + r.metrics.output_tokens, 0);
    const totalTokens = totalInputTokens + totalOutputTokens;
    const totalCost = computeCost(
        { input_tokens: totalInputTokens, cached_input_tokens: totalCachedInputTokens, output_tokens: totalOutputTokens },
        effectivePricing
    );
    const results = {
        run_id: runId,
        suite_id: suite.suite_id,
        suite_version: suite.version,
        mode,
        tool_mode: toolMode ?? null,
        model: effectiveModel,
        pricing: effectivePricing,
        task_pack_hash: taskPackHash,
        summary: {
            total_cases: totalCases,
            pass_at_1: totalCases ? passedAt1 / totalCases : 0,
            pass_at_k: totalCases ? passedAny / totalCases : 0,
            input_tokens: totalInputTokens,
            cached_input_tokens: totalCachedInputTokens,
            output_tokens: totalOutputTokens,
            total_tokens: totalTokens,
            total_cost: totalCost ?? null,
            wall_ms_total: Math.round(suiteDuration)
        },
        cases: caseResults
    };

    manifest["completed_at"] = new Date().toISOString();
    writeJson(path.join(runDir, "manifest.json"), manifest);
    writeJson(path.join(runDir, "results.json"), results);

    logAt(
        "summary",
        `\n✅ Summary: pass@1 ${(totalCases ? passedAt1 / totalCases : 0).toFixed(2)} | pass@k ${(totalCases ? passedAny / totalCases : 0).toFixed(2)} | tokens in=${totalInputTokens} out=${totalOutputTokens} | cost ${totalCost !== undefined ? totalCost.toFixed(4) : "-"} | wall ${Math.round(suiteDuration)}ms`
    );

    const reportPath = path.join(repoRoot, "benchmarks", "reports", `agent-report-${runId}.md`);
    ensureDir(path.dirname(reportPath));
    const reportLines: string[] = [];
    reportLines.push("# Agent Benchmark Report");
    reportLines.push("");
    reportLines.push(`- Run ID: ${runId}`);
    reportLines.push(`- Suite: ${suite.suite_id} v${suite.version}`);
    reportLines.push(`- Mode: ${mode}`);
    reportLines.push(`- Tool Mode: ${toolMode ?? "default"}`);
    reportLines.push(`- Model: ${effectiveModel.provider}/${effectiveModel.id}`);
    if (effectivePricing) {
        reportLines.push(
            `- Pricing: ${effectivePricing.snapshot ?? "-"} ${effectivePricing.currency ?? ""} (in=${effectivePricing.input_per_1k ?? 0}/1k, out=${effectivePricing.output_per_1k ?? 0}/1k)`
        );
    }
    reportLines.push("");
    reportLines.push("## Summary");
    reportLines.push("| Metric | Value |");
    reportLines.push("| --- | --- |");
    reportLines.push(`| Total Cases | ${totalCases} |`);
    reportLines.push(`| Pass@1 | ${(totalCases ? passedAt1 / totalCases : 0).toFixed(2)} |`);
    reportLines.push(`| Pass@k | ${(totalCases ? passedAny / totalCases : 0).toFixed(2)} |`);
    reportLines.push(`| Input Tokens | ${totalInputTokens} |`);
    reportLines.push(`| Output Tokens | ${totalOutputTokens} |`);
    reportLines.push(`| Total Tokens | ${totalTokens} |`);
    reportLines.push(`| Total Cost | ${totalCost !== undefined ? totalCost.toFixed(4) : "-"} |`);
    reportLines.push(`| Total Wall Time (ms) | ${Math.round(suiteDuration)} |`);
    reportLines.push("");
    reportLines.push("## Cases");
    reportLines.push("| Case | Category | Pass@1 | Passed | Attempts | In Tokens | Out Tokens | Total Tokens | Cost | Wall(ms) |");
    reportLines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const caseResult of caseResults) {
        const wall = caseResult.metrics.wall_ms_to_first_success ?? 0;
        reportLines.push(
            `| ${caseResult.id} | ${caseResult.category} | ${caseResult.pass_at_1 ? "yes" : "no"} | ${caseResult.passed ? "yes" : "no"} | ${caseResult.attempts} | ${caseResult.metrics.input_tokens} | ${caseResult.metrics.output_tokens} | ${caseResult.metrics.total_tokens} | ${caseResult.metrics.total_cost !== null ? caseResult.metrics.total_cost.toFixed(4) : "-"} | ${wall} |`
        );
    }
    fs.writeFileSync(reportPath, reportLines.join("\n"));

    logAt("summary", `✅ Agent benchmark complete: ${runDir}`);
    logAt("summary", `Report: ${path.relative(repoRoot, reportPath)}`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
