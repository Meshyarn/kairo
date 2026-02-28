import { BaseHandler } from "../BaseHandler.js";
import type { HandlerContext } from "../HandlerContext.js";

export class KairoSearchHandler extends BaseHandler {
  private context: HandlerContext;

  constructor(context: HandlerContext) {
    super(context.toolSpecRegistry);
    this.context = context;
  }

  async handle(name: string, args: any): Promise<any> {
    if (name !== "kairo_search") return null;

    const missing = this.validateRequiredArgs(name, args);
    if (missing.length > 0) {
      return this.errorResponse(
        "MissingParameter",
        `Missing: ${missing.join(", ")}`,
      );
    }

    const { query, scope = "code", limit = 10, fileTypes } = args;

    try {
      let allResults: Array<{
        file: string;
        line: number;
        snippet: string;
        score: number;
      }> = [];

      // Code search via SearchEngine (Tantivy BM25F + vector re-ranking)
      if (scope === "code" || scope === "all") {
        const codeResults = await this.context.searchEngine.scout({
          query,
          maxResults: limit,
          fileTypes,
          semanticSymbols: true,
        });
        allResults.push(
          ...codeResults.map((r: any) => ({
            file: r.filePath ?? r.file ?? "",
            line: r.lineNumber ?? r.line ?? 0,
            snippet: (r.preview ?? r.snippet ?? "").slice(0, 400),
            score: r.score ?? 0,
          })),
        );
      }

      // Document search via DocumentSearchEngine
      if (scope === "docs" || scope === "all") {
        try {
          const docResponse = await this.context.documentSearchEngine.search(
            query,
            { maxResults: limit },
          );
          const docResults = docResponse?.results ?? docResponse ?? [];
          const docArray = Array.isArray(docResults) ? docResults : [];
          allResults.push(
            ...docArray.map((r: any) => ({
              file: r.filePath ?? r.path ?? r.file ?? "",
              line: r.lineNumber ?? r.line ?? 0,
              snippet: (r.preview ?? r.snippet ?? r.text ?? "").slice(0, 400),
              score: r.score ?? 0,
            })),
          );
        } catch {
          // Document search may not be available; silently degrade
        }
      }

      // Sort by score descending and limit
      allResults.sort((a, b) => b.score - a.score);
      const results = allResults.slice(0, limit);

      return this.jsonResponse({
        results,
        truncated: allResults.length > limit,
      });
    } catch (error: any) {
      return this.errorResponse(
        "SearchError",
        error?.message ?? "Search failed",
      );
    }
  }
}
