import type { ManageHandlerDeps } from "./ManageHandlerUtils.js";

export const handleReindex = async (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const reindexState = deps.reindexState;
  const suppressLogs = Boolean(args?.suppressLogs ?? args?.quiet);
  if (suppressLogs) {
    context.dependencyGraph.setLoggingEnabled(false);
  }
  try {
    const paths: string[] = Array.isArray(args?.paths)
      ? (args.paths as unknown[])
        .map((value: unknown) => String(value).trim())
        .filter(Boolean)
      : [];
    if (paths.length > 0) {
      if (!context.incrementalIndexer) {
        return {
          success: false,
          output: "Incremental indexer is unavailable; use full reindex instead.",
          suggestedActions: [
            {
              id: "manage.reindex.full",
              priority: 1,
              description: "Run a full reindex.",
              rationale: "Incremental indexing is not available in this runtime.",
              toolCall: { tool: "manage", args: { command: "reindex" } },
              tags: ["repair_ladder", "attempt_3"]
            }
          ]
        };
      }
      const absPaths = paths.map((entry: string) => deps.resolveAbsolutePath(entry));
      const enqueued = context.incrementalIndexer.enqueuePaths(absPaths, "high");
      context.cacheInvalidationHub?.onEvent({ type: "reindex_start" });
      return {
        success: true,
        output: "Reindex enqueued (paths).",
        scope: "paths",
        enqueued,
        paths
      };
    }
    if (reindexState.inProgress) {
      return { success: false, output: "Reindex already in progress." };
    }
    const startedAt = new Date();
    reindexState.inProgress = true;
    context.indexStateManager.markReindexStart();
    context.cacheInvalidationHub?.onEvent({ type: "reindex_start" });
    reindexState.lastResult = {
      success: false,
      output: "Reindex in progress.",
      startedAt: startedAt.toISOString()
    };

    await context.skeletonCache.clearAll();

    if (context.isTestEnv()) {
      const finishedAt = new Date();
      reindexState.lastResult = {
        success: true,
        output: "Reindex completed (test mode: caches cleared only).",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString()
      };
      reindexState.inProgress = false;
      context.indexStateManager.markReindexComplete();
      context.cacheInvalidationHub?.onEvent({ type: "reindex_complete" });
      return { success: true, output: "Reindex completed (test mode).", activity: { reindexInProgress: false } };
    }

    void (async () => {
      try {
        await context.searchEngine.rebuild({ logEvery: 500 });
        if (context.incrementalIndexer) {
          await context.incrementalIndexer.reindexAll();
        } else {
          throw new Error("Incremental indexer unavailable for reindex.");
        }
        await context.dependencyGraph.build({ logEvery: 200 });
        if (context.documentIndexer) {
          await context.documentIndexer.rebuildAll();
        }
        const finishedAt = new Date();
        reindexState.lastResult = {
          success: true,
          output: "Reindex completed.",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString()
        };
        context.indexStateManager.markReindexComplete();
        context.cacheInvalidationHub?.onEvent({ type: "reindex_complete" });
      } catch (error: any) {
        const finishedAt = new Date();
        reindexState.lastResult = {
          success: false,
          output: error?.message ?? "Reindex failed.",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString()
        };
        context.indexStateManager.markReindexFailed();
      } finally {
        reindexState.inProgress = false;
        if (suppressLogs) {
          context.dependencyGraph.setLoggingEnabled(true);
        }
      }
    })();
    return { success: true, output: "Reindex started.", activity: { reindexInProgress: true } };
  } finally {
    if (suppressLogs) {
      context.dependencyGraph.setLoggingEnabled(true);
    }
  }
};
