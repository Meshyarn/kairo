import path from "path";
import { PathManager } from "../../../utils/PathManager.js";
import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { ProgressState } from "../../../utils/ProgressLogger.js";
import type { UnderstandExecutionSetup } from "./UnderstandPillarExecutionSetup.js";
import { isDocumentPath } from "./DependencyAnalysis.js";

export interface UnderstandSearchResolution {
  searchResult: { results: any[] };
  filePath: string;
  symbolName?: string;
  isDocument: boolean;
}

export async function resolveUnderstandTarget(args: {
  setup: UnderstandExecutionSetup;
  context: OrchestrationContext;
  runTool: (context: OrchestrationContext, tool: string, args: any, progress?: ProgressState) => Promise<any>;
  progress?: ProgressState;
}): Promise<{ response?: any; resolution?: UnderstandSearchResolution }> {
  const { setup, context, runTool, progress } = args;
  const { input } = setup;

  let resolvedPath = input.explicitPath ?? null;
  let searchResult = { results: [] as any[] };

  if (resolvedPath && !/[\\/]/.test(resolvedPath)) {
    const fileMatches = await runTool(context, "project_search", {
      query: resolvedPath,
      type: "filename",
      maxResults: 5
    }, progress);
    if (fileMatches?.results?.length) {
      resolvedPath = fileMatches.results[0].path;
    }
  }

  if (!resolvedPath) {
    const searchMaxResults = typeof input.constraints.limit === "number" && Number.isFinite(input.constraints.limit) && input.constraints.limit > 0
      ? input.constraints.limit
      : 5;
    searchResult = await runSearch(context, {
      query: input.subject,
      symbolHint: input.symbolHint,
      scope: input.constraints.scope,
      maxResults: searchMaxResults,
      budget: setup.searchBudget
    }, runTool, progress);
  }

  if ((!searchResult.results || searchResult.results.length === 0) && !resolvedPath) {
    return { response: { success: false, status: "no_results", summary: "No relevant code found.", results: [] } };
  }

  const primaryResult = resolvedPath ? { path: resolvedPath } : searchResult.results[0];
  let filePath = primaryResult.path;
  let symbolName = primaryResult?.symbol?.name;
  if (setup.includeCallsPlanned && !symbolName && input.symbolHint) {
    const symbolMatches = await runTool(context, "project_search", {
      query: input.symbolHint,
      type: "symbol",
      maxResults: 10
    }, progress);
    const match = symbolMatches?.results?.find((result: any) => result.path === filePath) ?? symbolMatches?.results?.[0];
    if (match?.symbol?.name) {
      symbolName = match.symbol.name;
      if (!resolvedPath && match?.path) {
        filePath = match.path;
      }
    }
  }

  if (setup.traceBuilder && setup.includeCallsPlanned && !symbolName) {
    setup.traceBuilder.recordSkip("call_graph", "not_applicable", "symbol not resolved");
  }

  const isDocument = isDocumentPath(filePath);
  if (setup.traceBuilder && isDocument) {
    if (setup.includeCallsPlanned) {
      setup.traceBuilder.recordSkip("call_graph", "unsupported", "document targets skip call graph");
    }
    if (setup.includeDependenciesPlanned) {
      setup.traceBuilder.recordSkip("dependencies", "unsupported", "document targets skip dependencies");
    }
    if (setup.includeHotSpotsPlanned) {
      setup.traceBuilder.recordSkip("hot_spots", "unsupported", "document targets skip hotspots");
    }
  }

  return {
    resolution: {
      searchResult,
      filePath,
      symbolName,
      isDocument
    }
  };
}

async function runSearch(
  context: OrchestrationContext,
  args: { query: string; symbolHint?: string | null; scope?: string; maxResults: number; budget?: any },
  runTool: (context: OrchestrationContext, tool: string, args: any, progress?: ProgressState) => Promise<any>,
  progress?: ProgressState
): Promise<any> {
  const attempts: Array<{ type: "filename" | "symbol" | "file" }> = [];
  attempts.push({ type: "filename" });
  if (args.symbolHint) {
    attempts.push({ type: "symbol" });
  } else if (args.scope !== "project") {
    attempts.push({ type: "symbol" });
  }
  attempts.push({ type: "file" });

  for (const attempt of attempts) {
    const result = await runTool(context, "project_search", {
      query: args.query,
      type: attempt.type,
      maxResults: args.maxResults,
      budget: attempt.type === "file" ? args.budget : undefined
    }, progress);
    const filtered = filterSearchResults(result);
    if (filtered?.results?.length) {
      return filtered;
    }
  }

  return { results: [] };
}

function filterSearchResults(result: any): any {
  if (!result?.results?.length) {
    return result;
  }
  const filteredResults = result.results.filter((entry: any) => {
    const rawPath = typeof entry?.path === "string" ? entry.path : "";
    if (!rawPath) return false;
    const normalized = rawPath.replace(/\\/g, "/");
    const baseDir = PathManager.getBaseDir()
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .replace(/^\.\//, "");
    const hasCustomBase = baseDir && !path.isAbsolute(baseDir);
    return !normalized.includes("/.kairo/")
      && !normalized.startsWith(".kairo/")
      && !(hasCustomBase && (normalized.includes(`/${baseDir}/`) || normalized.startsWith(`${baseDir}/`)))
      && !normalized.includes("/.mcp/")
      && !normalized.startsWith(".mcp/")
      && !normalized.includes("/node_modules/")
      && !normalized.startsWith("node_modules/")
      && !normalized.includes("/dist/")
      && !normalized.startsWith("dist/")
      && !normalized.includes("/coverage/")
      && !normalized.startsWith("coverage/");
  });

  return { ...result, results: filteredResults };
}
