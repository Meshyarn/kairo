import { promises as fs } from "node:fs";
import path from "node:path";

type Mode = "report" | "strict";
type Phase = "A" | "B" | "C";

type Violation = {
    filePath: string;
    line: number;
    preview: string;
};

const IMPORT_PATTERNS: RegExp[] = [
    /\bimport\s+.+\s+from\s+['"](?:node:)?fs['"]/,
    /\bimport\s+.+\s+from\s+['"](?:node:)?fs\/promises['"]/,
    /\bimport\s+\*\s+as\s+fs\b/,
    /\brequire\(\s*['"]fs['"]\s*\)/,
    /\brequire\(\s*['"]node:fs['"]\s*\)/,
    /\brequire\(\s*['"]fs\/promises['"]\s*\)/,
    /\brequire\(\s*['"]node:fs\/promises['"]\s*\)/,
];

function parseArgs(argv: string[]): { mode: Mode; phase: Phase } {
    let mode: Mode = "report";
    let phase: Phase = "A";

    for (const arg of argv) {
        if (arg.startsWith("--mode=")) {
            const value = arg.slice("--mode=".length);
            if (value === "report" || value === "strict") mode = value;
        }
        if (arg.startsWith("--phase=")) {
            const value = arg.slice("--phase=".length).toUpperCase();
            if (value === "A" || value === "B" || value === "C") phase = value;
        }
    }

    return { mode, phase };
}

function resolveTargetDirs(phase: Phase): string[] {
    const dirs = ["src/orchestration", "src/handlers"];
    if (phase === "B" || phase === "C") {
        dirs.push("src/indexing");
    }
    if (phase === "C") {
        dirs.push("src/ast");
    }
    return dirs;
}

async function walkFiles(baseDir: string): Promise<string[]> {
    const result: string[] = [];
    const stack = [baseDir];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: Array<import("node:fs").Dirent> = [];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
            result.push(fullPath);
        }
    }
    return result;
}

async function scanFile(filePath: string): Promise<Violation[]> {
    let raw = "";
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch {
        return [];
    }
    const lines = raw.split(/\r?\n/);
    const violations: Violation[] = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;
        if (!IMPORT_PATTERNS.some((pattern) => pattern.test(line))) continue;
        violations.push({
            filePath,
            line: i + 1,
            preview: line.trim().slice(0, 200),
        });
    }
    return violations;
}

function formatViolation(v: Violation): string {
    const relative = path.relative(process.cwd(), v.filePath).replace(/\\/g, "/");
    return `${relative}:${v.line} ${v.preview}`;
}

async function main(): Promise<void> {
    const { mode, phase } = parseArgs(process.argv.slice(2));
    const targetDirs = resolveTargetDirs(phase).map((dir) => path.resolve(process.cwd(), dir));

    const files = (
        await Promise.all(targetDirs.map(async (dir) => walkFiles(dir)))
    ).flat();

    const violations = (
        await Promise.all(files.map(async (filePath) => scanFile(filePath)))
    ).flat();

    if (violations.length === 0) {
        console.log(`[validate-fs-boundary] OK (phase=${phase}, mode=${mode})`);
        return;
    }

    console.log(`[validate-fs-boundary] Found ${violations.length} fs boundary violation(s):`);
    for (const v of violations) {
        console.log(`- ${formatViolation(v)}`);
    }

    if (mode === "strict") {
        process.exitCode = 1;
    }
}

await main();

