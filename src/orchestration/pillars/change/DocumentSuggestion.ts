import * as path from 'path';
import { OrchestrationContext } from "../../OrchestrationContext.js";

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

  if (aggregated.length === 0) return undefined;
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
