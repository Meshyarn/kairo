import fs from "fs";
import path from "path";
import ignore from "ignore";
import type { RepoConfig } from "../../config/RepoRegistry.js";
import type { BoundaryEvidence } from "../boundaries/types.js";
import { PathManager } from "../../utils/PathManager.js";

const DEFAULT_EXCLUDE_PATTERNS = (() => {
  const patterns = [
    "dist/**",
    "coverage/**",
    "node_modules/**",
    ".git/**",
    ".mcp/**",
    ".kairo/**"
  ];

  const baseDir = PathManager.getBaseDir()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "");
  if (baseDir && !path.isAbsolute(baseDir)) {
    patterns.push(`${baseDir}/**`);
  }

  return Array.from(new Set(patterns));
})();

export type ScannedFile = {
  absolutePath: string;
  relativePath: string;
};

export type IgnoreFilter = {
  add(patterns: string[] | string): void;
  ignores(pathname: string): boolean;
};

export function buildIgnoreFilter(repo: RepoConfig): IgnoreFilter {
  const filter = (ignore as unknown as () => IgnoreFilter)();
  filter.add(DEFAULT_EXCLUDE_PATTERNS);
  if (Array.isArray(repo.excludePatterns)) {
    filter.add(repo.excludePatterns);
  }
  return filter;
}

export function walkRepoFiles(repo: RepoConfig, filter: IgnoreFilter): ScannedFile[] {
  const results: ScannedFile[] = [];
  const stack = [repo.path];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(repo.path, absolutePath).replace(/\\/g, "/");
      if (relativePath && filter.ignores(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      results.push({ absolutePath, relativePath });
    }
  }

  return results;
}

export function filterByExtensions(files: ScannedFile[], extensions: string[]): ScannedFile[] {
  const normalized = new Set(extensions.map((ext) => ext.toLowerCase()));
  return files.filter((file) => normalized.has(path.extname(file.relativePath).toLowerCase()));
}

export function filterByBasename(files: ScannedFile[], names: string[]): ScannedFile[] {
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  return files.filter((file) => normalized.has(path.basename(file.relativePath).toLowerCase()));
}

export function buildEvidence(paths: string[], type: string): BoundaryEvidence[] {
  return paths.map((filePath) => ({ path: filePath, type }));
}

export function normalizeManifestId(value: string): string {
  return value.replace(/[\\/]/g, "__").replace(/[^A-Za-z0-9_\\-]+/g, "_");
}

export function loadFileContent(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export function scanForPattern(files: ScannedFile[], matcher: RegExp): boolean {
  for (const file of files) {
    let content = "";
    try {
      content = fs.readFileSync(file.absolutePath, "utf-8");
    } catch {
      continue;
    }
    if (matcher.test(content)) {
      return true;
    }
  }
  return false;
}
