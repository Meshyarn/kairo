import path from "path";
import { PathManager } from "../../utils/PathManager.js";

const BASE_EXCLUDE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.mcp/**",
  "**/.kairo/**",
  ".kairo/**",
  "**/dist/**",
  "**/coverage/**",
  "**/*.test.*",
  "**/*.spec.*"
];

export const getBuiltinExcludeGlobs = (): string[] => {
  const patterns = [...BASE_EXCLUDE_GLOBS];
  const baseDir = PathManager.getBaseDir()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "");
  if (baseDir && !path.isAbsolute(baseDir)) {
    patterns.push(`**/${baseDir}/**`, `${baseDir}/**`);
  }
  return Array.from(new Set(patterns));
};

export const globToRegExp = (glob: string): RegExp => {
  let normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  let prefix = "";
  if (normalized.startsWith("**/")) {
    normalized = normalized.slice(3);
    prefix = "(?:.*/)?";
  }
  if (!normalized.includes("/") && !/[?*]/.test(normalized)) {
    const escaped = normalized.replace(/[-/\\^$+?.()|[\\]{}]/g, "\\$&");
    return new RegExp(`(^|/)${escaped}(/|$)`);
  }

  const doubleStarPlaceholder = "__DOUBLE_STAR__";
  const singleStarPlaceholder = "__SINGLE_STAR__";
  const questionPlaceholder = "__QUESTION_MARK__";

  let effectiveNormalized = normalized;
  const hasTrailingGlobstar = normalized.endsWith("/**");
  if (hasTrailingGlobstar) {
    effectiveNormalized = normalized.slice(0, -3);
  }

  let pattern = effectiveNormalized
    .replace(/\*\*/g, doubleStarPlaceholder)
    .replace(/\*/g, singleStarPlaceholder)
    .replace(/\?/g, questionPlaceholder)
    .replace(/([.+^${}()|[\]\\])/g, "\\$1")
    .replace(new RegExp(doubleStarPlaceholder, "g"), ".*")
    .replace(new RegExp(singleStarPlaceholder, "g"), "[^/]*")
    .replace(new RegExp(questionPlaceholder, "g"), ".");

  if (hasTrailingGlobstar) {
    pattern = `${pattern}(?:/.*)?`;
  }
  return new RegExp(`^${prefix}${pattern}$`);
};

export const normalizeRelativePath = (filePath: string, basePath: string): string | null => {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(basePath, filePath);
  const relative = path.relative(basePath, absolute);
  if (relative.startsWith("..")) {
    return null;
  }
  return relative.replace(/\\/g, "/") || path.basename(absolute);
};

export const shouldInclude = (relativePath: string, includeRegexes?: RegExp[], excludeRegexes?: RegExp[]): boolean => {
  const normalized = relativePath.split(path.sep).join("/");
  const hasIncludePatterns = !!(includeRegexes && includeRegexes.length > 0);
  const matchesInclude = hasIncludePatterns ? includeRegexes!.some(regex => regex.test(normalized)) : true;
  if (!matchesInclude) {
    return false;
  }
  const matchesExclude = excludeRegexes?.some(regex => regex.test(normalized)) ?? false;

  if (matchesExclude && !(hasIncludePatterns && matchesInclude)) {
    return false;
  }
  return true;
};
