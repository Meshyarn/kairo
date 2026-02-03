import path from "path";
import type { FileSearchResult } from "../../types.js";
import { computeMatchStats, findLineMatches } from "./SearchUtils.js";
import type { FileScanRequest } from "../../orchestration/capabilities/FileScan.js";

export const scanForMatches = async (args: FileScanRequest): Promise<FileSearchResult[]> => {
  if (args.usage) {
    args.usage.degraded = true;
    args.usage.reason = args.usage.reason ?? args.reason;
  }
  const scanRoot = args.basePath ?? args.rootPath;
  let files: string[];
  try {
    files = await args.fileSystem.listFiles(scanRoot);
  } catch {
    return [];
  }

  const normalizedTypes = Array.isArray(args.fileTypes) && args.fileTypes.length > 0
    ? new Set(args.fileTypes.map((ext) => ext.replace(/^\./, "").toLowerCase()).filter(Boolean))
    : null;
  const results: FileSearchResult[] = [];

  for (const absPath of files) {
    if (args.budget && args.usage) {
      const elapsed = Date.now() - args.startedAt;
      if (
        args.usage.filesRead >= args.budget.maxFilesRead ||
        args.usage.bytesRead >= args.budget.maxBytesRead ||
        elapsed >= args.budget.maxParseTimeMs
      ) {
        args.usage.degraded = true;
        args.usage.reason = args.usage.reason ?? "budget_exceeded";
        break;
      }
    }

    const relativePath = args.normalizeRelativePath(absPath, scanRoot);
    if (!relativePath || !args.shouldInclude(relativePath, args.includeRegexes, args.excludeRegexes)) {
      continue;
    }

    if (normalizedTypes) {
      const ext = path.extname(relativePath).replace(".", "").toLowerCase();
      if (!normalizedTypes.has(ext)) {
        continue;
      }
    }

    let content = "";
    try {
      content = await args.fileSystem.readFile(absPath);
      if (args.usage) {
        args.usage.filesRead += 1;
        args.usage.bytesRead += Buffer.byteLength(content, "utf8");
      }
    } catch {
      continue;
    }

    const matches = findLineMatches(content, args.regexes, args.matchesPerFileLimit, args.previewLength);
    if (matches.length === 0) {
      continue;
    }
    const matchStats = computeMatchStats(content, path.basename(relativePath), args.keywords, args.keywordRegexes, args.patternRegexes);
    const score = matchStats.totalMatches * 10
      + matchStats.filenameMultiplier
      + (args.patternRegexes.length > 0 ? matchStats.patternMatches * 2 : 0);
    for (const match of matches) {
      results.push({
        filePath: relativePath,
        lineNumber: match.line,
        preview: match.preview,
        score,
        scoreDetails: {
          type: "scan",
          totalScore: score,
          contentScore: matchStats.totalMatches,
          filenameMatchType: matchStats.filenameMatchType,
          filenameMultiplier: matchStats.filenameMultiplier,
          depthMultiplier: 1,
          fieldWeight: 1
        }
      });
      if (results.length >= args.maxResults) {
        break;
      }
    }
    if (results.length >= args.maxResults) {
      break;
    }
  }
  return results;
};
