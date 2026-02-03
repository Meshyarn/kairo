import { resolveEmbeddingConfigFromEnv } from "../../embeddings/EmbeddingConfig.js";
import { computeEmbeddingDiagnostics } from "../../embeddings/EmbeddingDiagnostics.js";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { buildCatalogCoverage } from "../../utils/MetricsCatalog.js";
import { metrics } from "../../utils/MetricsCollector.js";
import type { ManageHandlerDeps } from "./ManageHandlerUtils.js";
import {
  buildBudgetSnapshot,
  buildCostSummary,
  buildEmbeddingFindings,
  buildNativeSearchStatus,
  buildProcessStats,
  buildRolloutStatus,
  buildSymbolIndexStatus,
  buildTelemetrySummary,
  buildWorkspaceDrift,
  recordBudgetMetrics,
  recordIndexMetrics
} from "./ManageStatusUtils.js";
import { buildWorkflowSummary } from "./ManageWorkflowUtils.js";

export const handleStatus = async (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const reindexState = deps.reindexState;
  const suppressLogs = Boolean(args?.suppressLogs ?? args?.quiet);
  if (suppressLogs) {
    context.dependencyGraph.setLoggingEnabled(false);
  }
  try {
    const detail = args?.detail ?? args?.verbosity ?? "summary";
    const includePerFile = detail === "full" || detail === "verbose" || args?.includePerFile === true;
    const shouldEnsureBuilt = includePerFile || args?.ensureBuilt === true;
    if (shouldEnsureBuilt) {
      await context.dependencyGraph.ensureBuilt();
    }
    const status = await context.dependencyGraph.getIndexStatus({ includePerFile });
    const lastRebuiltAt = status?.global?.lastRebuiltAt
      ? Date.parse(status.global.lastRebuiltAt)
      : undefined;
    context.indexStateManager.updateTotals(
      status?.global?.totalFiles ?? 0,
      status?.global?.indexedFiles ?? status?.global?.totalFiles ?? 0,
      Number.isFinite(lastRebuiltAt) ? lastRebuiltAt : undefined
    );
    const indexSnapshot = await context.indexStateManager.getSnapshot();
    const indexActivity = context.indexStateManager.getActivity();
    const embeddingStatus = await context.documentSearchEngine.getEmbeddingStatus();
    const embeddingDiagnostics = computeEmbeddingDiagnostics();
    const embeddingFindings = buildEmbeddingFindings(embeddingDiagnostics);
    const capabilityDiagnostics = EngineManager.getDiagnosticsSnapshot({
      detail: detail === "full" ? "full" : "summary",
      rootPath: context.rootPath
    });
    const rolloutStatus = buildRolloutStatus(context, status?.global?.totalFiles);
    const symbolIndexStatus = buildSymbolIndexStatus(context);
    const nativeSearchStatus = buildNativeSearchStatus(context);
    const driftStatus = await buildWorkspaceDrift(context);
    const metricsSnapshot = metrics.snapshot();
    const costSummary = buildCostSummary(status?.global?.totalFiles, metricsSnapshot);
    const telemetrySummary = buildTelemetrySummary(metricsSnapshot);
    const processStats = buildProcessStats();
    const workflowSummary = buildWorkflowSummary(context);

    if (includePerFile) {
      return {
        success: true,
        output: "Index status",
        status,
        embedding: embeddingStatus,
        embeddingDiagnostics,
        embeddingFindings,
        capabilityDiagnostics,
        indexSnapshot,
        symbolIndex: symbolIndexStatus,
        nativeSearch: nativeSearchStatus,
        drift: driftStatus,
        cost: costSummary,
        telemetry: telemetrySummary,
        processStats,
        ...workflowSummary,
        rollout: rolloutStatus,
        activity: {
          reindexInProgress: reindexState.inProgress,
          lastReindex: reindexState.lastResult,
          indexingActivity: indexActivity
        }
      };
    }
    const limit = typeof args?.limit === "number" ? args.limit : 20;
    const unresolvedByFile = new Map<string, string[]>();
    const resolutionErrors = status?.global?.resolutionErrors ?? [];
    for (const entry of resolutionErrors) {
      const filePath = String((entry as any)?.filePath ?? "");
      const spec = String((entry as any)?.importSpecifier ?? "");
      if (!filePath || !spec) continue;
      const list = unresolvedByFile.get(filePath) ?? [];
      list.push(spec);
      unresolvedByFile.set(filePath, list);
    }
    if (unresolvedByFile.size === 0) {
      const perFile = status?.perFile ?? {};
      for (const [filePath, entry] of Object.entries(perFile)) {
        const unresolved = Array.isArray((entry as any)?.unresolvedImports)
          ? (entry as any).unresolvedImports
          : [];
        if (unresolved.length === 0) continue;
        unresolvedByFile.set(filePath, unresolved.map((spec: any) => String(spec)));
      }
    }
    const unresolvedSample = Array.from(unresolvedByFile.entries())
      .slice(0, limit)
      .map(([filePath, unresolvedImports]) => ({ filePath, unresolvedImports }));
    return {
      success: true,
      output: "Index status",
      status: {
        global: status.global,
        unresolvedSample
      },
      embedding: embeddingStatus,
      embeddingDiagnostics,
      embeddingFindings,
      capabilityDiagnostics,
      indexSnapshot,
      symbolIndex: symbolIndexStatus,
      nativeSearch: nativeSearchStatus,
      drift: driftStatus,
      cost: costSummary,
      telemetry: telemetrySummary,
      processStats,
      ...workflowSummary,
      rollout: rolloutStatus,
      activity: {
        reindexInProgress: reindexState.inProgress,
        lastReindex: reindexState.lastResult,
        indexingActivity: indexActivity
      }
    };
  } finally {
    if (suppressLogs && !reindexState.inProgress) {
      context.dependencyGraph.setLoggingEnabled(true);
    }
  }
};

export const handleMetrics = async (deps: ManageHandlerDeps) => {
  const context = deps.context;
  const indexSnapshot = context.indexStateManager
    ? await context.indexStateManager.getSnapshot()
    : undefined;
  if (indexSnapshot) {
    recordIndexMetrics(indexSnapshot);
  }
  const budgetSnapshot = await buildBudgetSnapshot(context);
  if (budgetSnapshot) {
    recordBudgetMetrics(budgetSnapshot);
  }
  const snapshot = metrics.snapshot();
  return {
    success: true,
    output: "Metrics snapshot.",
    metrics: snapshot,
    catalogCoverage: buildCatalogCoverage(snapshot, "basic")
  };
};

export const handleMetricsReset = () => {
  metrics.reset();
  return {
    success: true,
    output: "Metrics reset."
  };
};

export const handleConfig = () => {
  const embeddingConfig = resolveEmbeddingConfigFromEnv();
  return {
    success: true,
    output: "Config snapshot.",
    config: {
      metrics: {
        mode: process.env.KAIRO_METRICS_MODE ?? "basic"
      },
      embedding: {
        provider: embeddingConfig.provider ?? "auto"
      }
    }
  };
};
