import fs from "fs";
import path from "path";
import ignore from "ignore";
import { LanguageConfigLoader } from "./LanguageConfig.js";
import { getSupportForLanguageId, SupportLevel } from "./LanguageSupportLevels.js";
import type { LanguageShare, RepoSummary } from "./ConfigBootstrapperTypes.js";
import { DEFAULT_EXCLUDE_PATTERNS, getDefaultIgnoreDirs } from "./ConfigBootstrapperDefaults.js";

export function buildIgnoreFilter(rootPath: string) {
    const ig = (ignore as unknown as () => any)();
    const patterns = loadIgnorePatterns(rootPath);
    const defaultDirs = getDefaultIgnoreDirs();
    const defaults = defaultDirs.map((dir) => `${dir}/**`);
    ig.add([...defaults, ...patterns]);
    return ig;
}

export function scanLanguages(
    rootPath: string,
    baseDir: string,
    ignoreFilter: any,
    languageConfig: LanguageConfigLoader,
    options: { maxFiles: number; includeDocs: boolean; sampleBytesPerFile: number }
): { languages: LanguageShare[]; unknownExtensions: string[]; truncated: boolean } {
    const extCounts = new Map<string, number>();
    const unknownExtensions = new Set<string>();
    let total = 0;
    let truncated = false;

    const baseAbs = path.resolve(baseDir);
    const stack = [baseAbs];

    while (stack.length > 0) {
        if (total >= options.maxFiles) {
            truncated = true;
            break;
        }
        const current = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (total >= options.maxFiles) {
                truncated = true;
                break;
            }
            if (entry.isSymbolicLink()) continue;
            const absPath = path.join(current, entry.name);
            const relPath = path.relative(rootPath, absPath).replace(/\\/g, "/");
            if (relPath && ignoreFilter.ignores(relPath)) {
                continue;
            }
            if (entry.isDirectory()) {
                stack.push(absPath);
                continue;
            }
            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!ext) continue;
            if (!options.includeDocs && (ext === ".md" || ext === ".mdx")) {
                continue;
            }
            const mapping = languageConfig.getLanguageMapping(ext);
            if (!mapping) {
                unknownExtensions.add(ext);
                continue;
            }
            total += 1;
            extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
        }
    }

    const languageCounts = new Map<string, number>();
    for (const [ext, count] of extCounts.entries()) {
        const mapping = languageConfig.getLanguageMapping(ext);
        if (!mapping) continue;
        const languageId = mapping.languageId;
        languageCounts.set(languageId, (languageCounts.get(languageId) ?? 0) + count);
    }

    const languages: LanguageShare[] = [];
    for (const [languageId, count] of languageCounts.entries()) {
        const support = getSupportForLanguageId(languageId);
        languages.push({
            languageId,
            supportLevel: support?.level === SupportLevel.L3 ? "L3" : support ? "L2" : undefined,
            share: total > 0 ? count / total : 0
        });
    }

    languages.sort((a, b) => b.share - a.share);

    return {
        languages,
        unknownExtensions: Array.from(unknownExtensions.values()).sort(),
        truncated
    };
}

export function detectRepositories(args: {
    rootPath: string;
    ignoreFilter: any;
    languageConfig: LanguageConfigLoader;
    options: { maxFiles: number; includeDocs: boolean; sampleBytesPerFile: number };
    multiRepoMode: "auto" | "single" | "detect";
    globalScan: { languages: LanguageShare[] };
    slugify: (value: string) => string;
    titleCase: (value: string) => string;
}): RepoSummary[] {
    const repos: RepoSummary[] = [];
    const repoPaths = new Set<string>();

    const rootLanguages = args.globalScan.languages.map((lang) => lang.languageId);
    repos.push({
        id: "main",
        path: ".",
        name: "Main Repo",
        type: "primary",
        languages: rootLanguages,
        allowCrossRepoEdits: false,
        excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS]
    });
    repoPaths.add(path.resolve(args.rootPath));

    if (args.multiRepoMode === "single") {
        return repos;
    }

    const candidates: Array<{ path: string; type: "linked" | "reference"; name?: string }> = [];
    candidates.push(...detectCargoCrates(args.rootPath));
    candidates.push(...detectNodePackages(args.rootPath, "packages"));
    candidates.push(...detectNodePackages(args.rootPath, "apps"));
    candidates.push(...detectWorkspacePackages(args.rootPath));

    for (const candidate of candidates) {
        const absPath = path.resolve(args.rootPath, candidate.path);
        if (repoPaths.has(absPath)) continue;
        if (!fs.existsSync(absPath)) continue;
        const langScan = scanLanguages(args.rootPath, absPath, args.ignoreFilter, args.languageConfig, {
            ...args.options,
            maxFiles: Math.min(args.options.maxFiles, 5000)
        });
        const repoId = args.slugify(path.basename(candidate.path));
        repos.push({
            id: repoId,
            path: candidate.path,
            name: candidate.name ?? args.titleCase(repoId.replace(/-/g, " ")),
            type: candidate.type,
            languages: langScan.languages.map((lang) => lang.languageId),
            allowCrossRepoEdits: false,
            excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS]
        });
        repoPaths.add(absPath);
    }

    return repos;
}

function loadIgnorePatterns(rootPath: string): string[] {
    const ignoreFiles = collectIgnoreFiles(rootPath);
    const patterns: string[] = [];
    for (const absPath of ignoreFiles) {
        try {
            const content = fs.readFileSync(absPath, "utf-8");
            const relDir = path.relative(rootPath, path.dirname(absPath)).replace(/\\/g, "/");
            const parsed = content
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && !line.startsWith("#"))
                .map((line) => normalizeIgnorePattern(line, relDir));
            patterns.push(...parsed);
        } catch {
            continue;
        }
    }
    return patterns;
}

function collectIgnoreFiles(rootPath: string): string[] {
    const ignoreFiles: string[] = [];
    const ignoreDirs = new Set(getDefaultIgnoreDirs());
    const stack = [rootPath];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (ignoreDirs.has(entry.name)) {
                    continue;
                }
                stack.push(entryPath);
                continue;
            }
            if (entry.name === ".gitignore" || entry.name === ".mcpignore") {
                ignoreFiles.push(entryPath);
            }
        }
    }
    return ignoreFiles;
}

function normalizeIgnorePattern(pattern: string, relDir: string): string {
    if (!pattern) return pattern;
    let negation = "";
    let normalized = pattern;
    if (normalized.startsWith("!")) {
        negation = "!";
        normalized = normalized.slice(1);
    }
    if (normalized.startsWith("/")) {
        normalized = normalized.slice(1);
    }
    if (relDir && relDir.length > 0) {
        normalized = `${relDir}/${normalized}`;
    }
    return `${negation}${normalized}`;
}

function detectCargoCrates(rootPath: string): Array<{ path: string; type: "linked"; name?: string }> {
    const cratesDir = path.join(rootPath, "crates");
    if (!fs.existsSync(cratesDir)) return [];
    const entries = fs.readdirSync(cratesDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
            path: path.join("crates", entry.name),
            type: "linked" as const,
            name: `Crate ${entry.name}`
        }))
        .filter((candidate) => fs.existsSync(path.join(rootPath, candidate.path, "Cargo.toml")));
}

function detectNodePackages(rootPath: string, baseDir: string): Array<{ path: string; type: "linked"; name?: string }> {
    const dir = path.join(rootPath, baseDir);
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
            path: path.join(baseDir, entry.name),
            type: "linked" as const,
            name: `Package ${entry.name}`
        }))
        .filter((candidate) => fs.existsSync(path.join(rootPath, candidate.path, "package.json")));
}

function detectWorkspacePackages(rootPath: string): Array<{ path: string; type: "linked"; name?: string }> {
    const packageJsonPath = path.join(rootPath, "package.json");
    if (!fs.existsSync(packageJsonPath)) return [];
    let parsed: any;
    try {
        parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    } catch {
        return [];
    }
    const workspaces = Array.isArray(parsed?.workspaces)
        ? parsed.workspaces
        : Array.isArray(parsed?.workspaces?.packages)
            ? parsed.workspaces.packages
            : [];
    const candidates: Array<{ path: string; type: "linked"; name?: string }> = [];
    for (const workspace of workspaces) {
        if (typeof workspace !== "string") continue;
        const resolved = expandWorkspacePattern(rootPath, workspace);
        for (const entry of resolved) {
            candidates.push({
                path: entry,
                type: "linked",
                name: `Workspace ${path.basename(entry)}`
            });
        }
    }
    return candidates.filter((candidate) => fs.existsSync(path.join(rootPath, candidate.path, "package.json")));
}

function expandWorkspacePattern(rootPath: string, pattern: string): string[] {
    if (!pattern.includes("*")) return [pattern];
    const segments = pattern.split("/");
    const results: string[] = [];
    const walk = (index: number, current: string) => {
        if (index >= segments.length) {
            results.push(path.relative(rootPath, current));
            return;
        }
        const segment = segments[index];
        if (!segment.includes("*")) {
            walk(index + 1, path.join(current, segment));
            return;
        }
        if (!fs.existsSync(current)) return;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        const matcher = new RegExp("^" + segment.replace(/\*/g, ".*") + "$");
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (!matcher.test(entry.name)) continue;
            walk(index + 1, path.join(current, entry.name));
        }
    };
    walk(0, rootPath);
    return results;
}
