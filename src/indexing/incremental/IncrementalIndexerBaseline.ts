import type { IndexingActivity } from "../IndexStateManager.js";
import { metrics } from "../../utils/MetricsCollector.js";

export function updateBaselineActivity(args: {
  baselineActive: boolean;
  baselineTotalFiles: number;
  baselineProcessedFiles: number;
  baselineStartedAt: number;
  phase: "scanning" | "indexing";
  onActivity?: (activity?: IndexingActivity) => void;
}): void {
  const { baselineActive, baselineTotalFiles, baselineProcessedFiles, baselineStartedAt, phase, onActivity } = args;
  if (!baselineActive) return;
  const processed = phase === "scanning" ? baselineTotalFiles : baselineProcessedFiles;
  const total = Math.max(baselineTotalFiles, 1);
  const elapsedMs = Math.max(1, Date.now() - baselineStartedAt);
  const rate = baselineProcessedFiles > 0 ? baselineProcessedFiles / elapsedMs : 0;
  const remaining = Math.max(0, baselineTotalFiles - baselineProcessedFiles);
  const eta = rate > 0 ? Math.round(remaining / rate) : undefined;
  const activity: IndexingActivity = {
    phase,
    processed,
    total,
    ...(eta ? { eta } : {})
  };
  indexerActivityGauge(remaining, total);
  onActivity?.(activity);
}

function indexerActivityGauge(remaining: number, total: number): void {
  metrics.gauge("baseline.pending_files", remaining);
  const ratio = total > 0 ? (total - remaining) / total : 0;
  metrics.gauge("baseline.progress_ratio", ratio);
}

export function resolveBaselineMaxMsPerTick(): number {
  const raw = Number.parseInt(process.env.KAIRO_BASELINE_MAX_MS_PER_TICK ?? "25", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 25;
}

export function resolveBaselineMaxFilesPerTick(): number {
  const raw = Number.parseInt(process.env.KAIRO_BASELINE_MAX_FILES_PER_TICK ?? "50", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 50;
}
