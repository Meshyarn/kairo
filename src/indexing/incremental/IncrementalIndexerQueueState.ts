export type PriorityLevel = "high" | "medium" | "low";

export type QueueState = Record<PriorityLevel, Map<string, number>>;

export function createQueueState(): QueueState {
  return {
    high: new Map(),
    medium: new Map(),
    low: new Map()
  };
}

export function flushQueue(queues: QueueState, priority: PriorityLevel): string[] {
  const queue = queues[priority];
  const entries = Array.from(queue.keys());
  queue.clear();
  return entries;
}

export function pullNextBatch(queues: QueueState): string[] {
  let entries: string[] = [];

  entries = entries.concat(flushQueue(queues, "high"));
  if (entries.length >= 50) return entries;

  entries = entries.concat(flushQueue(queues, "medium"));
  if (entries.length >= 100) return entries;

  entries = entries.concat(flushQueue(queues, "low"));
  return entries;
}

export function clearQueues(queues: QueueState): void {
  queues.high.clear();
  queues.medium.clear();
  queues.low.clear();
}

export function getTotalQueueSize(queues: QueueState): number {
  return queues.high.size + queues.medium.size + queues.low.size;
}

export function getQueueDepth(queues: QueueState): { high: number; medium: number; low: number; total: number } {
  const high = queues.high.size;
  const medium = queues.medium.size;
  const low = queues.low.size;
  return { high, medium, low, total: high + medium + low };
}

export function removeFromQueues(queues: QueueState, filePath: string): void {
  for (const queue of Object.values(queues)) {
    queue.delete(filePath);
  }
}

export function removeMatchingFromQueues(queues: QueueState, predicate: (path: string) => boolean): void {
  for (const queue of Object.values(queues)) {
    for (const key of Array.from(queue.keys())) {
      if (predicate(key)) {
        queue.delete(key);
      }
    }
  }
}
