import { OrchestrationContext } from "../../../OrchestrationContext.js";

export type TargetCandidate = { path: string; score?: number; reason: string };

export async function resolveTargetPath(
  intentText: string,
  context: OrchestrationContext,
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>
): Promise<{ targetPath?: string; candidates: TargetCandidate[] }> {
  const candidates: TargetCandidate[] = [];
  const explicit = extractPath(intentText);
  if (explicit) {
    return { targetPath: explicit, candidates: [{ path: explicit, reason: "explicit_path" }] };
  }

  const filenameSearch = await runTool(context, "project_search", {
    query: intentText,
    type: "filename",
    maxResults: 3
  });
  collectCandidates(candidates, filenameSearch?.results ?? [], "filename_search");

  const symbolSearch = await runTool(context, "project_search", {
    query: intentText,
    type: "symbol",
    maxResults: 3
  });
  collectCandidates(candidates, symbolSearch?.results ?? [], "symbol_search");

  const sorted = sortCandidates(candidates);
  return { targetPath: sorted[0]?.path, candidates: sorted };
}

export function extractPath(text: string): string | null {
  const match = text.match(/([\w./-]+\.(ts|tsx|js|jsx|json|md))/i);
  if (match) return match[1];
  return null;
}

export function sortCandidates(candidates: TargetCandidate[]): TargetCandidate[] {
  return candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function collectCandidates(candidates: TargetCandidate[], results: any[], reason: string) {
  for (const result of results) {
    if (result?.path && !candidates.find(c => c.path === result.path)) {
      candidates.push({ path: result.path, score: result.score, reason });
    }
  }
}
