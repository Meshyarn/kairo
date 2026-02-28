import { BaseHandler } from "../BaseHandler.js";
import type { HandlerContext } from "../HandlerContext.js";

export class KairoStatusHandler extends BaseHandler {
  private context: HandlerContext;

  constructor(context: HandlerContext) {
    super(context.toolSpecRegistry);
    this.context = context;
  }

  async handle(name: string, args: any): Promise<any> {
    if (name !== "kairo_status") return null;

    const { action = "check", scope = "overview", paths } = args;

    try {
      if (action === "reindex") {
        return await this.handleReindex(paths);
      }

      return await this.handleCheck(scope);
    } catch (error: any) {
      return this.errorResponse(
        "StatusError",
        error?.message ?? "Status check failed",
      );
    }
  }

  private async handleCheck(scope: string): Promise<any> {
    const status: any = {};

    // Overview: always included
    const nativeStatus = this.context.searchEngine.getNativeStatus();
    status.searchIndex = {
      available: nativeStatus.available,
      docCount: nativeStatus.stats?.docCount ?? 0,
      error: nativeStatus.error,
    };

    if (scope === "overview") return this.jsonResponse(status);

    // Search details
    if (scope === "search" || scope === "full") {
      status.searchReady = this.context.searchEngine.isIndexReady();
      status.nativeStats = nativeStatus.stats;
    }

    // Symbol index details
    if (scope === "symbols" || scope === "full") {
      try {
        const symbolStats =
          (this.context.symbolIndex as any)?.getStats?.() ?? null;
        status.symbolIndex = symbolStats;
      } catch {
        status.symbolIndex = null;
      }
    }

    // Process stats
    if (scope === "full") {
      const mem = process.memoryUsage();
      status.process = {
        uptimeSec: Math.floor(process.uptime()),
        memoryMb: Math.round(mem.heapUsed / 1024 / 1024),
      };
    }

    return this.jsonResponse(status);
  }

  private async handleReindex(paths?: string[]): Promise<any> {
    if (paths && paths.length > 0) {
      // Path-specific incremental reindex
      if (!this.context.incrementalIndexer) {
        return this.jsonResponse({
          success: false,
          hint: "Incremental indexer unavailable. Omit paths for full reindex.",
        });
      }

      const absPaths = paths.map((p: string) =>
        this.context.pathNormalizer.toAbsolute(p),
      );
      const enqueued = (this.context.incrementalIndexer as any).enqueuePaths?.(
        absPaths,
        "high",
      );

      this.context.cacheInvalidationHub?.onEvent?.({
        type: "reindex_start",
      } as any);

      return this.jsonResponse({
        success: true,
        scope: "paths",
        enqueued: enqueued ?? absPaths.length,
      });
    } else {
      // Full reindex
      await this.context.dependencyGraph.build();
      this.context.cacheInvalidationHub?.onEvent?.({
        type: "reindex_start",
      } as any);

      return this.jsonResponse({
        success: true,
        scope: "full",
      });
    }
  }
}
