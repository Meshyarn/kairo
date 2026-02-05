import * as path from "path";
import type { HandlerContext } from "./HandlerContext.js";
import type { FileSearchResult } from "../types.js";
import { resolveRepoInfo, isRepoIdInScope } from "../utils/RepoScope.js";

export function inferSearchType(query: string, declared: string): "file" | "symbol" | "directory" | "filename" {
  if (declared && declared !== "auto") {
    return declared as any;
  }
  if (/[\\/]/.test(query) || /\.[a-z0-9]+$/i.test(query)) {
    return "filename";
  }
  if (query.endsWith("/")) {
    return "directory";
  }
  return "file";
}

export function normalizeSearchResults(
  items: any[],
  context: HandlerContext,
  repoScope: any
): any[] {
  return items
    .map((item) => {
      if (!item?.path || typeof item.path !== "string") return null;
      try {
        const repoInfo = resolveRepoInfo(item.path, context.repoRegistry, context.pathNormalizer);
        if (repoScope && !isRepoIdInScope(repoInfo.repoId, repoScope)) return null;
        return {
          ...item,
          path: repoInfo.workspacePath,
          repoId: repoInfo.repoId,
          repoRelativePath: repoInfo.repoRelativePath
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as any[];
}

export async function fallbackFileSearch(context: HandlerContext, args: any): Promise<FileSearchResult[]> {
  const basePath = path.resolve(args.basePath ?? context.rootPath);
  const files = await listFilesRecursively(context, basePath);
  const keywords = Array.isArray(args?.keywords) ? args.keywords.map(String).filter(Boolean) : [];
  const patterns = Array.isArray(args?.patterns) ? args.patterns.map(String).filter(Boolean) : [];
  const caseSensitive = Boolean(args?.caseSensitive);
  const wordBoundary = Boolean(args?.wordBoundary);
  const maxResults = typeof args?.maxResults === "number" ? args.maxResults : 20;

  const keywordRegexes = keywords.map((kw: string) => buildKeywordRegex(kw, caseSensitive, wordBoundary));
  const patternRegexes = patterns.map((pattern: string) => {
    try {
      return new RegExp(pattern, caseSensitive ? "" : "i");
    } catch {
      return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "" : "i");
    }
  });

  const results: FileSearchResult[] = [];

  for (const filePath of files) {
    const relPath = path.relative(basePath, filePath).replace(/\\/g, "/");
    let content: string;
    try {
      content = await context.fileSystem.readFile(filePath);
    } catch {
      continue;
    }

    const matches = countMatches(content, path.basename(filePath), keywords, keywordRegexes, patternRegexes, caseSensitive);
    if (matches.totalMatches === 0 && matches.filenameMatchType === "none") {
      continue;
    }
    if (matches.totalMatches === 0 && wordBoundary) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const score = matches.totalMatches * 10 + matches.filenameMultiplier + (patternRegexes.length > 0 ? matches.patternMatches * 2 : 0);
    const lineNumbers = keywords.length > 0
      ? [matches.matchLines[0] ?? 0]
      : matches.matchLines.length > 0
        ? matches.matchLines
        : [0];

    for (const lineNumber of lineNumbers) {
      const previewLine = lineNumber > 0 ? lines[lineNumber - 1] ?? "" : lines[0] ?? "";
      results.push({
        filePath: relPath,
        lineNumber,
        preview: previewLine.slice(0, 240),
        score,
        scoreDetails: {
          type: "fallback",
          details: [],
          totalScore: score,
          contentScore: matches.totalMatches,
          filenameMatchType: matches.filenameMatchType,
          filenameMultiplier: matches.filenameMultiplier,
          depthMultiplier: 1,
          fieldWeight: 1
        }
      });
    }
  }

  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return results.slice(0, maxResults);
}

function buildKeywordRegex(keyword: string, caseSensitive: boolean, wordBoundary: boolean): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = wordBoundary ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern, caseSensitive ? "" : "i");
}

async function listFilesRecursively(context: HandlerContext, dir: string): Promise<string[]> {
  const stack = [dir];
  const results: string[] = [];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    let entries: string[];
    try {
      entries = await context.fileSystem.readDir(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absPath = path.join(current, entry);
      let stats;
      try {
        stats = await context.fileSystem.stat(absPath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      results.push(absPath);
    }
  }
  return results;
}

function countMatches(
  content: string,
  fileName: string,
  keywords: string[],
  keywordRegexes: RegExp[],
  patternRegexes: RegExp[],
  caseSensitive: boolean
) {
  const lines = content.split(/\r?\n/);
  const matchLines: number[] = [];
  let filenameMatchType: "exact" | "partial" | "none" = "none";
  let filenameMultiplier = 1;

  const normalizedFileName = fileName.toLowerCase();
  const fileBaseName = normalizedFileName.replace(/\.[^/.]+$/, "");
  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    if (fileBaseName === normalizedKeyword) {
      filenameMatchType = "exact";
      break;
    }
    if (normalizedFileName.includes(normalizedKeyword)) {
      filenameMatchType = "partial";
    }
  }
  if (filenameMatchType === "exact") {
    filenameMultiplier = 10;
  } else if (filenameMatchType === "partial") {
    filenameMultiplier = 5;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keywordMatch = keywordRegexes.some((regex) => regex.test(line));
    const patternMatch = patternRegexes.some((regex) => regex.test(line));
    if ((keywordMatch || patternMatch) && !matchLines.includes(i + 1)) {
      matchLines.push(i + 1);
    }
  }

  const keywordOccurrences = keywordRegexes.reduce((count, regex) => {
    const globalRegex = new RegExp(
      regex.source,
      `${regex.flags.includes("g") ? regex.flags : regex.flags + "g"}`
    );
    return count + (content.match(globalRegex)?.length ?? 0);
  }, 0);
  const patternOccurrences = patternRegexes.reduce((count, regex) => {
    const globalRegex = new RegExp(regex.source, `${regex.flags.includes("g") ? regex.flags : regex.flags + "g"}`);
    return count + (content.match(globalRegex)?.length ?? 0);
  }, 0);

  return {
    totalMatches: keywordOccurrences + patternOccurrences,
    patternMatches: patternOccurrences,
    filenameMatchType,
    filenameMultiplier,
    matchLines,
  };
}
