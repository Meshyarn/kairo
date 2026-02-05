import * as path from 'path';
import { OrchestrationContext } from "../../OrchestrationContext.js";
import { PathManager } from "../../../utils/PathManager.js";

export async function suggestDocUpdates(
  context: OrchestrationContext,
  targetPath: string,
  edits: any[],
  intentText: string,
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>,
  options?: { packId?: string }
): Promise<Array<{ filePath: string; sectionPath?: string[]; chunkId?: string; packId?: string; score?: number; preview?: string; section?: { content: string; resolvedHeadingPath?: string[] } }> | undefined> {
  const queries = new Set<string>();
  const basename = path.basename(targetPath);
  const ext = path.extname(basename);
  const stem = ext ? basename.slice(0, -ext.length) : basename;

  queries.add(targetPath);
  if (basename) queries.add(basename);
  if (stem && stem.length >= 3) queries.add(stem);

  const editTokens = edits
    .map(edit => edit?.targetString ?? edit?.search ?? edit?.from)
    .filter((value: any) => typeof value === 'string' && value.length > 0) as string[];
  for (const token of editTokens.slice(0, 2)) {
    const trimmed = token.trim();
    if (trimmed.length >= 3 && trimmed.length <= 80) {
      queries.add(trimmed);
    }
  }

  const queryList = Array.from(queries).filter(q => q.length >= 3);
  if (queryList.length === 0) return undefined;

  const packId = options?.packId;
  const aggregated: Array<{ filePath: string; sectionPath?: string[]; chunkId?: string; packId?: string; score?: number; preview?: string; section?: { content: string; resolvedHeadingPath?: string[] } }> = [];
  for (const query of queryList.slice(0, 3)) {
    try {
      const result = await runTool(context, 'document_search', {
        query,
        output: "compact",
        maxResults: 8,
        includeEvidence: false,
        packId
      });
      const sections = Array.isArray(result?.results) ? result.results : [];
      for (const section of sections) {
        if (!section?.filePath) continue;
        aggregated.push({
          chunkId: section.id,
          filePath: section.filePath,
          sectionPath: section.sectionPath,
          packId: result?.pack?.packId,
          score: section.scores?.final,
          preview: section.preview
        });
      }
    } catch {
      // ignore doc search failures
    }
  }

  if (aggregated.length === 0) {
    const fallback = await fallbackDocScan(context, runTool, queryList, packId);
    if (fallback.length === 0) return undefined;
    return attachDocSections(context, fallback, runTool);
  }
  const seen = new Set<string>();
  const deduped = aggregated.filter(item => {
    const key = `${item.filePath}::${item.chunkId ?? ''}::${(item.sectionPath ?? []).join('/')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  return attachDocSections(context, deduped, runTool);
}

async function attachDocSections(
  context: OrchestrationContext,
  docs: Array<{ filePath: string; sectionPath?: string[]; chunkId?: string; packId?: string; score?: number; preview?: string; section?: { content: string; resolvedHeadingPath?: string[] } }>,
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>
) {
  const output: Array<{ filePath: string; sectionPath?: string[]; chunkId?: string; packId?: string; score?: number; preview?: string; section?: { content: string; resolvedHeadingPath?: string[] } }> = [];
  const enabled = process.env.KAIRO_ATTACH_DOC_SECTIONS === "true";
  const sectionLimit = enabled ? Number.parseInt(process.env.KAIRO_ATTACH_DOC_SECTIONS_MAX ?? "0", 10) : 0;
  let attached = 0;
  for (const doc of docs) {
    const next = { ...doc };
    if (sectionLimit > 0 && attached < sectionLimit && Array.isArray(doc.sectionPath) && doc.sectionPath.length > 0) {
      try {
        const maxChars = Number.parseInt(process.env.KAIRO_DOC_SECTION_MAX_CHARS ?? "4000", 10);
        const section = await runTool(context, 'document_section', {
          filePath: doc.filePath,
          headingPath: doc.sectionPath,
          includeSubsections: false,
          mode: "preview",
          maxChars
        });
        if (section?.success && typeof section?.content === 'string') {
          next.section = {
            content: section.content,
            resolvedHeadingPath: section.resolvedHeadingPath
          };
          attached += 1;
        }
      } catch {
        // ignore
      }
    }
    output.push(next);
  }
  return output;
}

export function shouldSuggestDocs(constraints: any): boolean {
  if (constraints?.suggestDocs === true) return true;
  if (constraints?.options?.suggestDocs === true) return true;
  return process.env.KAIRO_CHANGE_SUGGEST_DOCS === "true";
}

async function fallbackDocScan(
  context: OrchestrationContext,
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>,
  queries: string[],
  packId?: string
): Promise<Array<{ filePath: string; sectionPath?: string[]; chunkId?: string; packId?: string; score?: number; preview?: string }>> {
  const docFiles = await listDocFiles(context, runTool);
  if (docFiles.length === 0) return [];
  const tokens = buildQueryTokens(queries);
  if (tokens.length === 0) return [];

  const matches: Array<{ filePath: string; score: number; preview: string }> = [];
  for (const filePath of docFiles) {
    let content: string;
    try {
      content = await runTool(context, "code_read", { filePath, view: "full" });
    } catch {
      continue;
    }
    if (typeof content !== "string" || content.length === 0) continue;
    const score = scoreContent(content, tokens);
    if (score <= 0) continue;
    matches.push({
      filePath,
      score,
      preview: buildPreview(content, tokens)
    });
    if (matches.length >= 8) break;
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 8).map(match => ({
    filePath: match.filePath,
    sectionPath: [],
    packId,
    score: match.score,
    preview: match.preview
  }));
}

async function listDocFiles(
  context: OrchestrationContext,
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>
): Promise<string[]> {
  const entries: Array<{ path?: string }> = [];
  const addEntries = (result: any) => {
    if (Array.isArray(result)) {
      entries.push(...result);
      return;
    }
    if (Array.isArray(result?.files)) {
      entries.push(...result.files);
      return;
    }
    if (Array.isArray(result?.results)) {
      entries.push(...result.results);
    }
  };

  try {
    addEntries(await runTool(context, "file_list", { basePath: "docs", depth: 6, maxFiles: 200 }));
  } catch {
    // ignore
  }
  if (entries.length === 0) {
    try {
      addEntries(await runTool(context, "file_list", { basePath: ".", depth: 4, maxFiles: 200 }));
    } catch {
      // ignore
    }
  }

  const files = entries
    .map(entry => entry?.path)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const seen = new Set<string>();
  return files.filter((filePath) => {
    const normalized = filePath.replace(/\\/g, "/");
    if (!isDocCandidate(normalized)) return false;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function isDocCandidate(filePath: string): boolean {
  if (!filePath) return false;
  const baseDir = PathManager.getBaseDir()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "");
  const hasCustomBase = baseDir && !path.isAbsolute(baseDir);
  if (filePath.startsWith(".kairo/") || filePath.includes("/.kairo/")) return false;
  if (hasCustomBase && (filePath.startsWith(`${baseDir}/`) || filePath.includes(`/${baseDir}/`))) return false;
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".txt") || lower.endsWith(".log")) {
    return true;
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return true;
  }
  return false;
}

function buildQueryTokens(queries: string[]): string[] {
  const tokens = new Set<string>();
  for (const query of queries) {
    const normalized = String(query ?? "").toLowerCase();
    if (normalized.length >= 3) tokens.add(normalized);
    for (const part of normalized.split(/[^a-z0-9_]+/)) {
      if (part.length >= 3) tokens.add(part);
    }
  }
  return Array.from(tokens);
}

function scoreContent(content: string, tokens: string[]): number {
  const haystack = content.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    score += countOccurrences(haystack, token);
  }
  return score;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function buildPreview(content: string, tokens: string[]): string {
  const haystack = content.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = haystack.indexOf(token);
    if (index >= 0) break;
  }
  if (index < 0) {
    return content.slice(0, 160).replace(/\s+/g, " ").trim();
  }
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + 120);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}
