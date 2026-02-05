import type { ProjectIndex } from "../ProjectIndex.js";
import type { ProjectIndexManager } from "../ProjectIndexManager.js";

export interface DebouncedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  cancel: () => void;
}

export function persistNow(args: {
  currentIndex: ProjectIndex | null;
  stopped: boolean;
  isFinal: boolean;
  pendingPersistence: Promise<void> | null;
  setPendingPersistence: (promise: Promise<void> | null) => void;
  indexManager: ProjectIndexManager;
}): Promise<void> | undefined {
  const { currentIndex, stopped, isFinal, pendingPersistence, setPendingPersistence, indexManager } = args;
  if (!currentIndex) return undefined;
  if (stopped && !isFinal) return undefined;
  if (pendingPersistence) return pendingPersistence;

  const promise = indexManager.persistIndex(currentIndex).finally(() => {
    setPendingPersistence(null);
  });
  setPendingPersistence(promise);
  return promise;
}

export function createDebouncedPersist(persist: () => Promise<void> | undefined): DebouncedFunction<() => void> {
  return debounce(async () => {
    await persist();
  }, 5000);
}

export function startPeriodicPersistence(args: {
  existingTimer?: NodeJS.Timeout;
  setTimer: (timer: NodeJS.Timeout) => void;
  persistNow: () => Promise<void> | undefined;
}): void {
  const { existingTimer, setTimer, persistNow } = args;
  if (existingTimer) {
    clearInterval(existingTimer);
  }
  const timer = setInterval(() => {
    void persistNow();
  }, 5 * 60 * 1000);
  timer.unref?.();
  setTimer(timer);
}

function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): DebouncedFunction<T> {
  let timeout: NodeJS.Timeout | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
    timeout.unref?.();
  };

  debounced.cancel = () => {
    if (timeout) clearTimeout(timeout);
  };

  return debounced;
}
