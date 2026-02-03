import { AdaptiveFlowReporter } from "../utils/AdaptiveFlowReporter.js";
import { MetricsExportService } from "../utils/metrics/MetricsExportService.js";
import { PathManager } from "../utils/PathManager.js";
import type { AlertDispatcher } from "../utils/AlertDispatcher.js";

export function initMetricsReporter(args: {
  isTestEnv: () => boolean;
  rootPath: string;
  alertDispatcher?: AlertDispatcher;
  parseNumberEnv: (raw: string | undefined, fallback: number) => number;
}): AdaptiveFlowReporter | undefined {
  const { isTestEnv, rootPath, alertDispatcher, parseNumberEnv } = args;
  if (isTestEnv()) return undefined;
  const enabled = process.env.KAIRO_METRICS_ENABLED !== "false";
  if (!enabled) return undefined;
  const reporter = new AdaptiveFlowReporter({
    rootPath,
    exportDir: process.env.KAIRO_METRICS_DIR
      ?? PathManager.getMetricsDir(),
    exportIntervalMs: parseNumberEnv(process.env.KAIRO_METRICS_INTERVAL_MS, 60_000),
    alertThresholds: {
      topologySuccessRate: parseNumberEnv(process.env.KAIRO_TOPOLOGY_SUCCESS_MIN, 0.95),
      ucgMemoryMb: parseNumberEnv(process.env.KAIRO_UCG_MEMORY_MAX_MB, 500),
      l3PromotionRatio: parseNumberEnv(process.env.KAIRO_L3_PROMOTION_RATIO_MAX, 0.5)
    },
    onAlert: payload => {
      console.warn(`[AdaptiveFlowReporter] ${payload.type}: ${payload.message}`);
      if (alertDispatcher) {
        void alertDispatcher.dispatch(payload).catch(error => {
          console.warn("[AdaptiveFlowReporter] Failed to forward alert", error);
        });
      }
    }
  });
  reporter.start();
  return reporter;
}

export function initMetricsExportService(args: {
  isTestEnv: () => boolean;
}): MetricsExportService | undefined {
  const { isTestEnv } = args;
  if (isTestEnv()) return undefined;
  const service = new MetricsExportService();
  void service.start().catch((error) => {
    console.warn("[SmartContextServer] Metrics export service failed to start:", error);
  });
  return service;
}
