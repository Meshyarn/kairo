export async function waitForIdle(args: {
  stopped: () => boolean;
  isProcessing: () => boolean;
  getQueueSize: () => number;
  sleep: (ms: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<boolean> {
  const { stopped, isProcessing, getQueueSize, sleep, timeoutMs } = args;
  const start = Date.now();
  const timeout = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : undefined;
  while (!stopped()) {
    if (!isProcessing() && getQueueSize() === 0) {
      return true;
    }
    if (timeout && Date.now() - start > timeout) {
      return false;
    }
    await sleep(50);
  }
  return false;
}

export async function waitForInitialScan(args: {
  initialScanPromise?: Promise<void>;
  waitForIdle: () => Promise<boolean>;
  flushNativeSearch?: () => void;
}): Promise<void> {
  const { initialScanPromise, waitForIdle, flushNativeSearch } = args;
  if (initialScanPromise) {
    await initialScanPromise;
  }
  await waitForIdle();
  flushNativeSearch?.();
}

import type { ProjectIndex } from "../ProjectIndex.js";

export async function reindexAll(args: {
  initialScanPromise?: Promise<void>;
  processingPromise: Promise<void> | null;
  clearQueues: () => void;
  createEmptyIndex: () => ProjectIndex;
  setCurrentIndex: (index: ProjectIndex) => void;
  persistNow: (isFinal?: boolean) => Promise<void>;
  enqueueInitialScan: () => Promise<void>;
  setInitialScanPromise: (promise: Promise<void>) => void;
  waitForIdle: () => Promise<boolean>;
  flushNativeSearch?: () => void;
}): Promise<void> {
  const {
    initialScanPromise,
    processingPromise,
    clearQueues,
    createEmptyIndex,
    setCurrentIndex,
    persistNow,
    enqueueInitialScan,
    setInitialScanPromise,
    waitForIdle,
    flushNativeSearch
  } = args;

  if (initialScanPromise) {
    await initialScanPromise;
  }
  if (processingPromise) {
    await processingPromise;
  }
  clearQueues();
  setCurrentIndex(createEmptyIndex());
  await persistNow(true);
  const scanPromise = enqueueInitialScan();
  setInitialScanPromise(scanPromise);
  await scanPromise;
  await waitForIdle();
  flushNativeSearch?.();
}
