import * as path from "path";

export const splitLines = (content: string): string[] => {
  return content.split(/\r?\n/);
};

export const computeLineOffsets = (content: string): number[] => {
  const offsets: number[] = [];
  let offset = 0;
  const lines = splitLines(content);
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1; // assume single newline (CRLF already split)
  }
  return offsets;
};

export const parseFrontmatter = (content: string): Record<string, unknown> | undefined => {
  if (!content.startsWith("---")) return undefined;
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return undefined;
  const raw = content.slice(3, endIndex).trim();
  if (!raw) return undefined;
  const result: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w\-]+)\s*:\s*(.+)\s*$/);
    if (!match) continue;
    const [, key, valueRaw] = match;
    result[key] = parseFrontmatterValue(valueRaw);
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

export const parseFrontmatterValue = (value: string): unknown => {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber) && trimmed !== "") return asNumber;
  return trimmed.replace(/^['"]|['"]$/g, "");
};

export const stripInlineJsx = (value: string): string => {
  return value.replace(/<[^>]+>/g, "").trim();
};

export const isFence = (line: string): boolean => {
  return /^```|^~~~/.test(line.trim());
};

export const normalizeReference = (value: string): string => {
  return String(value || "").trim().toLowerCase();
};

export const resolveFallbackTitle = (filePath: string): string => {
  return path.basename(filePath);
};
