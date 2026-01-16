import { OrchestrationContext } from "../../OrchestrationContext.js";
import type { ProgressState } from "./DependencyAnalysis.js";

type RunTool = (context: OrchestrationContext, tool: string, args: any, progress?: ProgressState) => Promise<any>;

export function extractSymbol(text: string): string | null {
  if (!text) return null;
  const explicitMatch = text.match(/\b(?:method|function|class|symbol)\s+([A-Za-z_$][\w$]*)/i);
  if (explicitMatch) return explicitMatch[1];
  const tokens = text.split(/\s+/).map(token =>
    token.replace(/^[\"'`(]+/, "").replace(/[\"'`),.;]+$/, "")
  );
  for (const token of tokens) {
    if (!token || /[\\/]/.test(token)) continue;
    const hashMatch = token.match(/^[A-Za-z_$][\w$]*#([A-Za-z_$][\w$]*)$/);
    if (hashMatch) return hashMatch[1];
    const dotMatch = token.match(/^[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)$/);
    if (dotMatch) {
      const candidate = dotMatch[1].toLowerCase();
      if (!['ts', 'tsx', 'js', 'jsx', 'json', 'md'].includes(candidate)) {
        return dotMatch[1];
      }
    }
  }
  return null;
}

export async function fetchCallGraph(args: {
  context: OrchestrationContext;
  filePath: string;
  symbolName: string;
  depth: string;
  runTool: RunTool;
  progress?: ProgressState;
}): Promise<any> {
  const { context, filePath, symbolName, depth, runTool, progress } = args;
  return runTool(context, "relationship_analyze", {
    target: symbolName,
    contextPath: filePath,
    mode: "calls",
    direction: "both",
    maxDepth: depth === "deep" ? 3 : 1,
    semanticSymbols: depth === "deep"
  }, progress);
}
