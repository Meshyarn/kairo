import path from "path";
import type { SymbolIndex } from "../../ast/SymbolIndex.js";
import type { DocumentIndexer } from "../DocumentIndexer.js";
import type { QueueState, PriorityLevel } from "./IncrementalIndexerQueueState.js";
import { metrics } from "../../utils/MetricsCollector.js";

export type QueueMetricsState = {
  recentEventCount: number;
  lastEventBurst: number;
  currentPauseMs: number;
  maxQueueDepthSeen: number;
  lastDepthLogAt: number;
};

export function enqueuePath(args: {
  filePath: string;
  priority: PriorityLevel;
  symbolIndex: SymbolIndex;
  isDocumentFile: (filePath: string) => boolean;
  isWithinRoot: (filePath: string) => boolean;
  documentIndexer?: DocumentIndexer;
  queues: QueueState;
  removeFromQueues: (filePath: string) => void;
  onFileQueued?: (filePath: string) => void;
  onFileIndexed?: (filePath: string) => void;
  queueMetrics: QueueMetricsState;
  defaultPauseMs: number;
  maxPauseMs: number;
  getTotalQueueSize: () => number;
}): boolean {
  const {
    filePath,
    priority,
    symbolIndex,
    isDocumentFile,
    isWithinRoot,
    documentIndexer,
    queues,
    removeFromQueues,
    onFileQueued,
    onFileIndexed,
    queueMetrics,
    defaultPauseMs,
    maxPauseMs,
    getTotalQueueSize
  } = args;

  if (!isWithinRoot(filePath)) return false;
  const isCode = symbolIndex.isSupported(filePath);
  const isDoc = isDocumentFile(filePath);
  if (!isCode && !isDoc) return false;

  if (isDoc && !isCode) {
    const normalized = path.resolve(filePath);
    const finalPath = normalized;
    onFileQueued?.(finalPath);
    void documentIndexer?.indexFile(filePath).then(() => {
      onFileIndexed?.(finalPath);
    });
    return true;
  }

  const normalized = path.resolve(filePath);
  const finalPath = normalized;

  onFileQueued?.(finalPath);

  const now = Date.now();
  const burstLimit = 1000;
  if (now - queueMetrics.lastEventBurst < burstLimit) {
    queueMetrics.recentEventCount += 1;
  } else {
    queueMetrics.recentEventCount = 1;
    queueMetrics.lastEventBurst = now;
  }

  if (queueMetrics.recentEventCount > 50) {
    queueMetrics.currentPauseMs = Math.min(queueMetrics.currentPauseMs * 1.5, maxPauseMs);
  } else if (queueMetrics.recentEventCount < 10) {
    queueMetrics.currentPauseMs = Math.max(defaultPauseMs, queueMetrics.currentPauseMs / 1.5);
  }

  removeFromQueues(finalPath);
  queues[priority].set(finalPath, now);

  const totalDepth = getTotalQueueSize();
  queueMetrics.maxQueueDepthSeen = Math.max(queueMetrics.maxQueueDepthSeen, totalDepth);

  metrics.inc("indexer.events");
  metrics.gauge("indexer.queue_depth", totalDepth);
  metrics.gauge("indexer.pause_ms", queueMetrics.currentPauseMs);

  if (totalDepth > 100 && (now - queueMetrics.lastDepthLogAt > 5000)) {
    console.info(`[IncrementalIndexer] High queue depth: ${totalDepth} (pause=${queueMetrics.currentPauseMs}ms)`);
    queueMetrics.lastDepthLogAt = now;
  }

  return true;
}
