import { QueryTokenizer } from "../QueryTokenizer.js";
import type { KeywordConstraint } from "./SearchTypes.js";

export const normalizeFileTypes = (fileTypes: string[] | undefined): string[] | undefined => {
  if (!Array.isArray(fileTypes) || fileTypes.length === 0) return undefined;
  const normalized = fileTypes
    .map((ext) => String(ext ?? "").trim())
    .map((ext) => ext.replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) return undefined;
  return Array.from(new Set(normalized));
};

export const extractPatternHintTokens = (patterns: string[] | undefined): string[] => {
  if (!Array.isArray(patterns) || patterns.length === 0) return [];
  const tokens = new Set<string>();
  const matcher = /[\p{L}\p{N}_]{2,}/gu;
  for (const pattern of patterns) {
    const text = String(pattern ?? "");
    for (const match of text.match(matcher) ?? []) {
      tokens.add(match);
    }
  }
  return Array.from(tokens);
};

export const buildCandidateQuery = (tokenizer: QueryTokenizer, query: string, patternHints: string[]): string => {
  const tokens = new Set<string>();
  const normalizedQuery = tokenizer.normalize(query ?? "");
  for (const token of normalizedQuery.split(/\s+/)) {
    if (token) tokens.add(token);
  }
  for (const hint of patternHints ?? []) {
    const normalizedHint = tokenizer.normalize(String(hint ?? ""));
    for (const token of normalizedHint.split(/\s+/)) {
      if (token) tokens.add(token);
    }
  }
  return Array.from(tokens).slice(0, 40).join(" ");
};

export const buildKeywordRegexes = (
  constraints: KeywordConstraint[],
  options: { escape: (value: string) => string }
): RegExp[] => {
  const regexes: RegExp[] = [];
  for (const constraint of constraints) {
    const escaped = options.escape(constraint.raw);
    const flags = constraint.requiresCaseSensitive ? "g" : "gi";
    regexes.push(new RegExp(escaped, flags));
  }
  return regexes;
};

export const buildPatternRegexes = (
    patterns: string[] | undefined,
    options: { caseSensitive: boolean; escape: (value: string) => string }
): RegExp[] => {
  if (!Array.isArray(patterns) || patterns.length === 0) return [];
  const flags = options.caseSensitive ? "g" : "gi";
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern, flags);
    } catch {
      return new RegExp(options.escape(pattern), flags);
    }
  });
};

export const normalizeSnippetLength = (requested: number | undefined, fallback: number): number => {
  if (typeof requested === "number" && Number.isFinite(requested)) {
    if (requested <= 0) return 0;
    return Math.min(2000, Math.max(16, Math.floor(requested)));
  }
  return fallback;
};

export const buildKeywordConstraints = (
  rawKeywords: string[],
  options: { caseSensitive: boolean; smartCase: boolean }
): KeywordConstraint[] => {
  const smartCase = options.smartCase !== false;
  return rawKeywords
    .map(keyword => keyword.trim())
    .filter(keyword => keyword.length > 0)
    .map(raw => {
      const requiresCaseSensitive = options.caseSensitive || (smartCase && /[A-Z]/.test(raw));
      return {
        raw,
        normalized: raw.toLowerCase(),
        requiresCaseSensitive
      };
    });
};

export const findLineMatches = (
  content: string,
  regexes: RegExp[],
  limit: number,
  previewLength: number
): Array<{ line: number; preview: string }> => {
  const lines = content.split(/\r?\n/);
  const matches: Array<{ line: number; preview: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const regex of regexes) {
      regex.lastIndex = 0;
      if (regex.test(line)) {
        const trimmed = line.trim();
        const preview = previewLength > 0 ? trimmed.slice(0, Math.max(1, previewLength)) : "";
        matches.push({ line: index + 1, preview });
        break;
      }
    }
    if (matches.length >= limit) break;
  }
  return matches;
};

export const computeMatchStats = (
  content: string,
  fileName: string,
  keywords: string[],
  keywordRegexes: RegExp[],
  patternRegexes: RegExp[]
): { totalMatches: number; patternMatches: number; filenameMatchType: "exact" | "partial" | "none"; filenameMultiplier: number } => {
  const normalizedFileName = fileName.toLowerCase();
  const fileBaseName = normalizedFileName.replace(/\.[^/.]+$/, "");
  let filenameMatchType: "exact" | "partial" | "none" = "none";
  let filenameMultiplier = 1;

  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    if (!normalizedKeyword) continue;
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

  const keywordMatches = countRegexOccurrences(content, keywordRegexes);
  const patternMatches = countRegexOccurrences(content, patternRegexes);
  return {
    totalMatches: keywordMatches + patternMatches,
    patternMatches,
    filenameMatchType,
    filenameMultiplier
  };
};

const countRegexOccurrences = (content: string, regexes: RegExp[]): number => {
  let count = 0;
  for (const regex of regexes) {
    const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
    const globalRegex = new RegExp(regex.source, flags);
    count += content.match(globalRegex)?.length ?? 0;
  }
  return count;
};
