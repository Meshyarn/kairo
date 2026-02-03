import type { QueueState } from "./IncrementalIndexerQueueState.js";
import { getQueueDepth } from "./IncrementalIndexerQueueState.js";
import type { QueueMetricsState } from "./IncrementalIndexerEnqueue.js";
import type { IndexerStatusSnapshot } from "../IncrementalIndexerTypes.js";

export function getQueueStats(
  queues: QueueState,
  queueMetrics: QueueMetricsState
): { currentDepth: number; maxDepthSeen: number; currentPauseMs: number } {
  const depth = getQueueDepth(queues);
  return {
    currentDepth: depth.total,
    maxDepthSeen: queueMetrics.maxQueueDepthSeen,
    currentPauseMs: queueMetrics.currentPauseMs
  };
}

export function getActivitySnapshot(args: {
  queues: QueueState;
  queueMetrics: QueueMetricsState;
  processing: boolean;
  activity?: { label: string; detail?: string; startedAt: number };
}): IndexerStatusSnapshot {
  const { queues, queueMetrics, processing, activity } = args;
  const depth = getQueueDepth(queues);
  return {
    queueDepth: depth,
    currentPauseMs: queueMetrics.currentPauseMs,
    maxQueueDepthSeen: queueMetrics.maxQueueDepthSeen,
    processing,
    activity: activity ? {
      label: activity.label,
      detail: activity.detail,
      startedAt: new Date(activity.startedAt).toISOString()
    } : undefined
  };
}
