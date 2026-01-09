import path from "path";
import type { StylePack, VibeAlignmentValidation } from "../types/flow-artifacts.js";

export type VibeStrictness = "strict" | "balanced" | "permissive";

export interface VibeAlignmentInput {
    filePath: string;
    content: string;
    stylePack?: StylePack;
    strictness?: VibeStrictness;
}

export function scoreVibeAlignment(input: VibeAlignmentInput): VibeAlignmentValidation {
    const { filePath, content, stylePack } = input;
    if (!stylePack) {
        return {
            verdict: "pass",
            score: 1.0,
            breakdown: {
                formatting: { score: 1.0, issues: [] },
                naming: { score: 1.0, issues: [] },
                imports: { score: 1.0, issues: [] },
                patterns: { score: 1.0, issues: [] }
            },
            deviations: [],
            summary: "Vibe alignment skipped (no StylePack provided)."
        };
    }

    const formatting = scoreFormatting(content, stylePack, filePath);
    const imports = scoreImports(content, stylePack, filePath);
    const naming = scoreNaming(content, stylePack, filePath);
    const patterns = scorePatterns(filePath, stylePack);

    const score = clamp01(
        formatting.score * 0.35
        + imports.score * 0.25
        + naming.score * 0.20
        + patterns.score * 0.20
    );

    const verdict = verdictForScore(score, input.strictness);

    return {
        verdict,
        score,
        breakdown: {
            formatting: { score: formatting.score, issues: formatting.issues },
            naming: { score: naming.score, issues: naming.issues },
            imports: { score: imports.score, issues: imports.issues },
            patterns: { score: patterns.score, issues: patterns.issues }
        },
        deviations: [
            ...formatting.deviations,
            ...imports.deviations,
            ...naming.deviations,
            ...patterns.deviations
        ],
        summary: verdict === "pass"
            ? "Vibe alignment matches style profile."
            : "Vibe alignment deviates from style profile."
    };
}

function scoreFormatting(content: string, stylePack: StylePack, filePath: string) {
    const issues: string[] = [];
    const deviations: VibeAlignmentValidation["deviations"] = [];
    const codeStyle = stylePack.profile.codeStyle;

    const lineBreaks = content.match(/\r\n|\n/g) ?? [];
    const crlfCount = lineBreaks.filter((value) => value === "\r\n").length;
    const lfCount = lineBreaks.length - crlfCount;
    const totalBreaks = Math.max(1, lineBreaks.length);
    const observedLineEndings = crlfCount > lfCount ? "crlf" : "lf";
    let lineEndingScore = 1.0;
    if (lineBreaks.length > 0 && codeStyle.lineEndings !== observedLineEndings) {
        const mismatchRatio = codeStyle.lineEndings === "crlf"
            ? lfCount / totalBreaks
            : crlfCount / totalBreaks;
        lineEndingScore = clamp01(1 - mismatchRatio);
        issues.push(`line endings mostly ${observedLineEndings}, expected ${codeStyle.lineEndings}`);
        deviations.push(makeDeviation(filePath, "format", "major", `line endings ${codeStyle.lineEndings}`, observedLineEndings));
    }

    const indentStats = detectIndent(content);
    let indentScore = 1.0;
    if (indentStats.totalLines > 0) {
        if (codeStyle.indent !== indentStats.indent) {
            indentScore = 0.2;
            issues.push(`indent uses ${indentStats.indent}, expected ${codeStyle.indent}`);
            deviations.push(makeDeviation(filePath, "format", "major", `indent ${codeStyle.indent}`, indentStats.indent));
        } else if (codeStyle.indent === "spaces" && indentStats.indentSize > 0 && codeStyle.indentSize !== indentStats.indentSize) {
            indentScore = 0.6;
            issues.push(`indent size ${indentStats.indentSize}, expected ${codeStyle.indentSize}`);
            deviations.push(makeDeviation(filePath, "format", "minor", `indent size ${codeStyle.indentSize}`, String(indentStats.indentSize)));
        }
    }

    const semicolonScore = scoreSemicolons(content, codeStyle.semicolons, issues, deviations, filePath);
    const quoteScore = scoreQuotes(content, codeStyle.quotes, issues, deviations, filePath);

    const score = clamp01((lineEndingScore + indentScore + semicolonScore + quoteScore) / 4);
    return { score, issues, deviations };
}

function scoreSemicolons(
    content: string,
    expectSemicolons: boolean,
    issues: string[],
    deviations: VibeAlignmentValidation["deviations"],
    filePath: string
): number {
    const lines = content.split(/\r\n|\n/);
    let sample = 0;
    let semicolons = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//")) continue;
        if (/[{(]$/.test(trimmed)) continue;
        if (/^\}/.test(trimmed)) continue;
        sample += 1;
        if (/;\s*(\/\/.*)?$/.test(trimmed)) {
            semicolons += 1;
        }
    }
    if (sample === 0) return 1.0;
    const ratio = semicolons / sample;
    const score = expectSemicolons ? ratio : 1 - ratio;
    if (expectSemicolons && ratio < 0.6) {
        issues.push("semicolon usage lower than expected");
        deviations.push(makeDeviation(filePath, "format", "minor", "use semicolons", "mixed"));
    }
    if (!expectSemicolons && ratio > 0.4) {
        issues.push("semicolons present but style expects none");
        deviations.push(makeDeviation(filePath, "format", "minor", "no semicolons", "present"));
    }
    return clamp01(score);
}

function scoreQuotes(
    content: string,
    expected: "single" | "double",
    issues: string[],
    deviations: VibeAlignmentValidation["deviations"],
    filePath: string
): number {
    const single = content.match(/'(?:\\.|[^'\\])*'/g)?.length ?? 0;
    const double = content.match(/"(?:\\.|[^"\\])*"/g)?.length ?? 0;
    const total = single + double;
    if (total === 0) return 1.0;
    const ratio = expected === "single" ? single / total : double / total;
    const score = clamp01(ratio);
    if (score < 0.7) {
        issues.push(`quote style uses ${expected === "single" ? "double" : "single"} more than expected`);
        deviations.push(makeDeviation(filePath, "format", "minor", `${expected} quotes`, expected === "single" ? "double quotes" : "single quotes"));
    }
    return score;
}

function scoreImports(content: string, stylePack: StylePack, filePath: string) {
    const issues: string[] = [];
    const deviations: VibeAlignmentValidation["deviations"] = [];
    const importLines = content.split(/\r\n|\n/).filter((line) => /^\s*import\s+/.test(line));
    if (importLines.length === 0 || stylePack.profile.patterns.imports.length === 0) {
        return { score: 1.0, issues, deviations };
    }

    const counts = {
        named: 0,
        default: 0,
        namespace: 0,
        "side-effect": 0
    };
    for (const line of importLines) {
        if (/^\s*import\s+["']/.test(line)) {
            counts["side-effect"] += 1;
        } else if (/^\s*import\s+\*\s+as\s+/.test(line)) {
            counts.namespace += 1;
        } else if (/^\s*import\s+{/.test(line)) {
            counts.named += 1;
        } else if (/^\s*import\s+[^,{]+,\s*{/.test(line)) {
            counts.named += 1;
            counts.default += 1;
        } else if (/^\s*import\s+[^,{]+\s+from/.test(line)) {
            counts.default += 1;
        }
    }

    const total = Math.max(1, Object.values(counts).reduce((sum, value) => sum + value, 0));
    const observed = {
        named: counts.named / total,
        default: counts.default / total,
        namespace: counts.namespace / total,
        "side-effect": counts["side-effect"] / total
    };

    const expectedCounts = stylePack.profile.patterns.imports.reduce((acc, pattern) => {
        acc[pattern.style] = (acc[pattern.style] ?? 0) + pattern.count;
        return acc;
    }, {} as Record<string, number>);
    const expectedTotal = Math.max(1, Object.values(expectedCounts).reduce((sum, value) => sum + value, 0));
    const expected = {
        named: (expectedCounts.named ?? 0) / expectedTotal,
        default: (expectedCounts.default ?? 0) / expectedTotal,
        namespace: (expectedCounts.namespace ?? 0) / expectedTotal,
        "side-effect": (expectedCounts["side-effect"] ?? 0) / expectedTotal
    };

    const distance = Math.abs(observed.named - expected.named)
        + Math.abs(observed.default - expected.default)
        + Math.abs(observed.namespace - expected.namespace)
        + Math.abs(observed["side-effect"] - expected["side-effect"]);
    const score = clamp01(1 - distance / 2);

    if (score < 0.7) {
        issues.push("import style distribution differs from profile");
        deviations.push(makeDeviation(filePath, "import", "minor", "import style distribution", "mismatch"));
    }

    return { score, issues, deviations };
}

function scoreNaming(content: string, stylePack: StylePack, filePath: string) {
    const issues: string[] = [];
    const deviations: VibeAlignmentValidation["deviations"] = [];
    const expected = dominantNamingConvention(stylePack);
    if (!expected) {
        return { score: 1.0, issues, deviations };
    }

    const names = extractNames(content);
    if (names.length === 0) {
        return { score: 1.0, issues, deviations };
    }

    const matches = names.filter((name) => matchesConvention(name, expected)).length;
    const ratio = matches / names.length;
    const score = clamp01(ratio);
    if (score < 0.7) {
        issues.push(`naming convention diverges from ${expected}`);
        deviations.push(makeDeviation(filePath, "naming", "minor", expected, "mixed"));
    }
    return { score, issues, deviations };
}

function scorePatterns(filePath: string, stylePack: StylePack) {
    const issues: string[] = [];
    const deviations: VibeAlignmentValidation["deviations"] = [];
    const fileNamePattern = stylePack.profile.patterns.fileOrg.fileNamePattern;
    if (!fileNamePattern) {
        return { score: 1.0, issues, deviations };
    }
    const fileName = path.basename(filePath);
    const matcher = globToRegex(fileNamePattern);
    const matches = matcher.test(fileName);
    if (!matches) {
        issues.push(`file name does not match pattern ${fileNamePattern}`);
        deviations.push(makeDeviation(filePath, "pattern", "minor", fileNamePattern, fileName));
    }
    return { score: matches ? 1.0 : 0.4, issues, deviations };
}

function detectIndent(content: string): { indent: "spaces" | "tabs"; indentSize: number; totalLines: number } {
    const lines = content.split(/\r\n|\n/);
    let spaceLines = 0;
    let tabLines = 0;
    const spaceIndents: number[] = [];
    for (const line of lines) {
        if (!/^\s+/.test(line)) continue;
        const match = line.match(/^(\s+)/);
        if (!match) continue;
        const leading = match[1];
        if (leading.includes("\t")) {
            tabLines += 1;
        } else {
            spaceLines += 1;
            spaceIndents.push(leading.length);
        }
    }
    const indent = tabLines > spaceLines ? "tabs" : "spaces";
    const indentSize = indent === "spaces" ? inferIndentSize(spaceIndents) : 1;
    return { indent, indentSize, totalLines: tabLines + spaceLines };
}

function inferIndentSize(values: number[]): number {
    if (values.length === 0) return 2;
    const filtered = values.filter((value) => value > 0);
    if (filtered.length === 0) return 2;
    return Math.min(...filtered);
}

function extractNames(content: string): string[] {
    const names: string[] = [];
    const classMatches = content.matchAll(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g);
    for (const match of classMatches) {
        if (match[1]) names.push(match[1]);
    }
    const funcMatches = content.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)/g);
    for (const match of funcMatches) {
        if (match[1]) names.push(match[1]);
    }
    const constMatches = content.matchAll(/\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g);
    for (const match of constMatches) {
        if (match[1]) names.push(match[1]);
    }
    return names.slice(0, 60);
}

function dominantNamingConvention(stylePack: StylePack): string | undefined {
    const naming = stylePack.profile.patterns.naming;
    if (!naming || naming.length === 0) return undefined;
    const sorted = [...naming].sort((a, b) => b.confidence - a.confidence);
    return sorted[0]?.convention;
}

function matchesConvention(name: string, convention: string): boolean {
    switch (convention) {
        case "camelCase":
            return /^[a-z][a-zA-Z0-9]*$/.test(name);
        case "PascalCase":
            return /^[A-Z][a-zA-Z0-9]*$/.test(name);
        case "snake_case":
            return /^[a-z][a-z0-9_]*$/.test(name);
        case "SCREAMING_SNAKE":
            return /^[A-Z][A-Z0-9_]*$/.test(name);
        case "kebab-case":
            return /^[a-z][a-z0-9-]*$/.test(name);
        default:
            return false;
    }
}

function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`);
}

function verdictForScore(score: number, strictness?: VibeStrictness): VibeAlignmentValidation["verdict"] {
    switch (strictness) {
        case "strict":
            if (score < 0.5) return "block";
            if (score < 0.7) return "warn";
            return "pass";
        case "permissive":
            if (score < 0.3) return "warn";
            return "pass";
        case "balanced":
        default:
            if (score < 0.25) return "block";
            if (score < 0.5) return "warn";
            return "pass";
    }
}

function makeDeviation(
    filePath: string,
    category: VibeAlignmentValidation["deviations"][number]["category"],
    severity: VibeAlignmentValidation["deviations"][number]["severity"],
    expected: string,
    actual: string
): VibeAlignmentValidation["deviations"][number] {
    return {
        file: filePath,
        expected,
        actual,
        category,
        severity
    };
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(1, value));
}
