import { isFence } from "./DocumentProfilerParsing.js";

export const extractMentions = (lines: string[]): Array<{ text: string; kind: "symbol" | "path"; line: number }> => {
  const seen = new Map<string, { text: string; kind: "symbol" | "path"; line: number }>();
  let inCodeBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFence(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    extractInlineCodeMentions(line, index + 1, seen);
    extractImportMentions(line, index + 1, seen);
    extractJsxMentions(line, index + 1, seen);
    extractCurlyMentions(line, index + 1, seen);
    extractPlainTextMentions(line, index + 1, seen);

    const genericMentions = line.matchAll(/@([a-zA-Z0-9_-]+)/g);
    for (const m of genericMentions) {
      registerMention(m[1], index + 1, seen);
    }
  }
  return Array.from(seen.values());
};

export const extractTags = (lines: string[]): string[] => {
  const tags = new Set<string>();
  let inCodeBlock = false;
  for (const line of lines) {
    if (isFence(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const matches = line.matchAll(/#([a-zA-Z0-9_\-/]+)/g);
    for (const match of matches) {
      const tag = match[1];
      if (tag && isNaN(Number(tag))) {
        tags.add(tag);
      }
    }
  }
  return Array.from(tags);
};

const extractInlineCodeMentions = (
  line: string,
  lineNumber: number,
  seen: Map<string, { text: string; kind: "symbol" | "path"; line: number }>
): void => {
  const matches = line.matchAll(/`([^`]+)`/g);
  for (const match of matches) {
    const raw = (match[1] ?? "").trim();
    if (!raw) continue;
    const tokens = raw.split(/\s+/);
    for (const token of tokens) {
      registerMention(token, lineNumber, seen);
    }
  }
};

const extractImportMentions = (
  line: string,
  lineNumber: number,
  seen: Map<string, { text: string; kind: "symbol" | "path"; line: number }>
): void => {
  if (!/^\s*(import|export)\b/.test(line)) return;
  const fromMatch = line.match(/\bfrom\s+['"]([^'"]+)['"]/);
  const sideEffectMatch = line.match(/\bimport\s+['"]([^'"]+)['"]/);
  const requireMatch = line.match(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/);
  const candidates = [fromMatch?.[1], sideEffectMatch?.[1], requireMatch?.[1]].filter(Boolean) as string[];
  for (const candidate of candidates) {
    registerMention(candidate, lineNumber, seen);
  }
};

const extractJsxMentions = (
  line: string,
  lineNumber: number,
  seen: Map<string, { text: string; kind: "symbol" | "path"; line: number }>
): void => {
  const matches = line.matchAll(/<([A-Z][A-Za-z0-9_$.]*)\b/g);
  for (const match of matches) {
    const token = match[1];
    if (!token) continue;
    registerMention(token, lineNumber, seen);
  }
};

const extractCurlyMentions = (
  line: string,
  lineNumber: number,
  seen: Map<string, { text: string; kind: "symbol" | "path"; line: number }>
): void => {
  const matches = line.matchAll(/\{\s*([A-Za-z_$][\w$]*)\s*\}/g);
  for (const match of matches) {
    const token = match[1];
    if (!token) continue;
    registerMention(token, lineNumber, seen);
  }
};

const extractPlainTextMentions = (
  line: string,
  lineNumber: number,
  seen: Map<string, { text: string; kind: "symbol" | "path"; line: number }>
): void => {
  if (!line || line.length < 3) return;
  const stripped = line
    .replace(/`[^`]+`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/[#>*_-]{2,}/g, " ");
  const tokens = stripped.split(/[^A-Za-z0-9_./$#]+/g);
  for (const token of tokens) {
    const candidate = token.trim();
    if (!candidate) continue;
    if (!isPlainTextCandidate(candidate)) continue;
    registerMention(candidate, lineNumber, seen);
  }
};

const registerMention = (
  token: string,
  lineNumber: number,
  seen: Map<string, { text: string; kind: "symbol" | "path"; line: number }>
): void => {
  const normalized = normalizeMentionToken(token);
  if (!normalized) return;
  const stripped = stripCallSuffix(normalized);
  if (!stripped || stripped.length > 120) return;
  const kind = isPathMention(stripped) ? "path" : (isSymbolMention(stripped) ? "symbol" : null);
  if (!kind) return;
  const key = `${kind}:${stripped}`;
  if (seen.has(key)) return;
  seen.set(key, { text: stripped, kind, line: lineNumber });
};

const normalizeMentionToken = (token: string): string => {
  const trimmed = token
    .replace(/^[`"'(<\[\{]+/, "")
    .replace(/[`"'\\\]\})>,;:.]+$/, "");
  if (!trimmed) return "";
  const withoutHash = trimmed.split("#")[0];
  return withoutHash.trim();
};

const stripCallSuffix = (token: string): string => {
  let output = token.trim();
  output = output.replace(/\(\)$/, "");
  output = output.replace(/\[\]$/, "");
  return output.trim();
};

const isPathMention = (token: string): boolean => {
  if (token.startsWith("./") || token.startsWith("../")) return true;
  if (token.includes("/") || token.includes("\\")) return true;
  return /\.[a-z0-9]+$/i.test(token);
};

const isSymbolMention = (token: string): boolean => {
  if (token.length < 2) return false;
  return /^[A-Za-z_$][\w$]*(?:[.#][A-Za-z_$][\w$]*)*$/.test(token);
};

const isPlainTextCandidate = (token: string): boolean => {
  if (token.length < 3 || token.length > 60) return false;
  if (/^\d+$/.test(token)) return false;
  if (COMMON_WORDS.has(token.toLowerCase())) return false;
  if (token.includes("/") || token.includes("\\")) return true;
  if (/\.[a-z0-9]+$/i.test(token)) return true;
  if (/[A-Z]/.test(token)) return true;
  if (token.includes("_")) return true;
  return false;
};

const COMMON_WORDS = new Set<string>([
  "the", "and", "or", "for", "with", "from", "that", "this", "these", "those",
  "are", "was", "were", "been", "have", "has", "had", "not", "can", "will",
  "may", "might", "should", "would", "into", "over", "under", "when", "where",
  "what", "which", "why", "how", "also", "only", "more", "most", "some", "any",
  "all", "each", "per", "via", "etc", "ex", "vs", "aka", "note", "todo"
]);
