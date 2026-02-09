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
      maxResults: 5,
      timeoutMs: setup.hasDeadline ? Math.max(200, Math.floor(setup.timeRemaining() * 0.5)) : undefined
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
      budget: setup.searchBudget,
      setup
    }, runTool, progress);
  }

  if ((!searchResult.results || searchResult.results.length === 0) && !resolvedPath) {
    return { response: { success: false, status: "no_results", summary: "No relevant code found.", results: [] } };
  }

  const primaryResult = resolvedPath
    ? { path: resolvedPath }
    : (pickPrimarySearchResult(searchResult.results, input.subject, input.symbolHint) ?? searchResult.results[0]);
  let filePath = primaryResult.path;
  let symbolName = primaryResult?.symbol?.name;
  if (
    setup.includeCallsPlanned
    && !symbolName
    && input.symbolHint
    && (!setup.hasDeadline || setup.timeRemaining() > 1200)
  ) {
    const symbolMatches = await runTool(context, "project_search", {
      query: input.symbolHint,
      type: "symbol",
      maxResults: 10,
      timeoutMs: setup.hasDeadline ? Math.max(200, Math.floor(setup.timeRemaining() * 0.45)) : undefined
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
  args: { query: string; symbolHint?: string | null; scope?: string; maxResults: number; budget?: any; setup: UnderstandExecutionSetup },
  runTool: (context: OrchestrationContext, tool: string, args: any, progress?: ProgressState) => Promise<any>,
  progress?: ProgressState
): Promise<any> {
  const lowTime = args.setup.hasDeadline && args.setup.timeRemaining() < 1400;
  const attempts: Array<{ type: "filename" | "symbol" | "file" }> = [];
  attempts.push({ type: "filename" });
  if (!lowTime && args.symbolHint) {
    attempts.push({ type: "symbol" });
  } else if (!lowTime && args.scope !== "project") {
    attempts.push({ type: "symbol" });
  }
  attempts.push({ type: "file" });

  for (const attempt of attempts) {
    if (args.setup.hasDeadline && args.setup.timeRemaining() < 250) {
      break;
    }
    const timeoutMs = args.setup.hasDeadline
      ? Math.max(200, Math.floor(args.setup.timeRemaining() * (attempt.type === "file" ? 0.7 : 0.45)))
      : undefined;
    const result = await runTool(context, "project_search", {
      query: args.query,
      type: attempt.type,
      maxResults: args.maxResults,
      budget: attempt.type === "file" ? args.budget : undefined,
      timeoutMs
    }, progress);
    const filtered = filterSearchResults(result);
    if (filtered?.results?.length) {
      return filtered;
    }
  }

  return { results: [] };
}

export function pickPrimarySearchResult(
  results: any[],
  subject: string,
  symbolHint?: string | null
): any | undefined {
  if (!Array.isArray(results) || results.length === 0) return undefined;
  const tokens = extractPreferenceTokens(subject, symbolHint);
  if (tokens.length === 0) return results[0];
  let best = results[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const item of results) {
    const score = scoreResult(item, tokens);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

function extractPreferenceTokens(subject: string, symbolHint?: string | null): string[] {
  const tokens: string[] = [];
  if (symbolHint && symbolHint.length > 1) tokens.push(symbolHint.toLowerCase());
  const queryTokens = String(subject ?? "")
    .split(/[\s,()]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && /[A-Za-z]/.test(token))
    .filter((token) => /[A-Z]/.test(token) || token.includes("/") || token.includes("."))
    .map((token) => token.toLowerCase());
  tokens.push(...queryTokens);
  return Array.from(new Set(tokens));
}

function scoreResult(result: any, tokens: string[]): number {
  const base = Number.isFinite(result?.score) ? result.score : 0;
  const filePath = typeof result?.path === "string" ? result.path.toLowerCase() : "";
  const symbolName = typeof result?.symbol?.name === "string" ? result.symbol.name.toLowerCase() : "";
  let bonus = 0;
  for (const token of tokens) {
    if (filePath.includes(token)) bonus += 8;
    if (symbolName === token) bonus += 18;
    else if (symbolName.includes(token)) bonus += 10;
  }
  return base + bonus;
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
