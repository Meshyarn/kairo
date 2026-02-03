import path from "path";
import { metrics } from "../../utils/MetricsCollector.js";

export async function enqueueInitialScan(args: {
  rootPath: string;
  stopped: () => boolean;
  fileSystem: { readDir: (dir: string) => Promise<string[]>; stat: (path: string) => Promise<{ isDirectory(): boolean }> };
  symbolIndex: { isSupported: (filePath: string) => boolean };
  isDocumentFile: (filePath: string) => boolean;
  shouldIgnore: (absolutePath: string) => boolean;
  enqueuePath: (filePath: string, priority: "high" | "medium" | "low") => void;
  batchShouldReindex: (files: string[]) => Promise<string[]>;
  resolveScanBatchSize: () => number;
  resolveBaselineMaxMsPerTick: () => number;
  resolveBaselineMaxFilesPerTick: () => number;
  updateBaselineActivity: (phase: "scanning" | "indexing") => void;
  sleep: (ms: number) => Promise<void>;
  baseline: {
    start: () => void;
    incrementTotalFiles: () => void;
    markScanCompleted: () => void;
    setScanStartedAt: () => void;
    updateActivity: (phase: "scanning" | "indexing") => void;
  };
}): Promise<void> {
  const {
    rootPath,
    stopped,
    fileSystem,
    symbolIndex,
    isDocumentFile,
    shouldIgnore,
    enqueuePath,
    batchShouldReindex,
    resolveScanBatchSize,
    resolveBaselineMaxMsPerTick,
    resolveBaselineMaxFilesPerTick,
    updateBaselineActivity,
    sleep,
    baseline
  } = args;

  baseline.start();
  baseline.setScanStartedAt();
  baseline.updateActivity("scanning");
  const stopInitialScan = metrics.startTimer("indexer.initial_scan_ms");
  const stopBaselineScan = metrics.startTimer("baseline.scan_ms");
  const stack: string[] = [rootPath];
  const batchSize = resolveScanBatchSize();
  const batchCounter = { count: 0 };
  const maxMsPerTick = resolveBaselineMaxMsPerTick();
  const maxFilesPerTick = resolveBaselineMaxFilesPerTick();

  try {
    while (stack.length > 0 && !stopped()) {
      const tickStart = Date.now();
      let tickFiles = 0;
      const current = stack.pop()!;
      let entries: string[];
      try {
        entries = await fileSystem.readDir(current);
      } catch {
        continue;
      }

      const supportedFiles: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(current, entry);
        if (shouldIgnore(fullPath)) continue;

        try {
          const stat = await fileSystem.stat(fullPath);
          if (stat.isDirectory()) {
            stack.push(fullPath);
          } else if (symbolIndex.isSupported(fullPath) || isDocumentFile(fullPath)) {
            supportedFiles.push(fullPath);
            baseline.incrementTotalFiles();
          }
        } catch {
          // ignore missing/stat failures
        }
        batchCounter.count += 1;
        tickFiles += 1;
        await yieldIfNeeded(batchCounter, batchSize, sleep);
        if (tickFiles >= maxFilesPerTick || (Date.now() - tickStart) >= maxMsPerTick) {
          updateBaselineActivity("scanning");
          await sleep(0);
          tickFiles = 0;
        }
      }

      const filesToIndex = await batchShouldReindex(supportedFiles);
      for (const filePath of filesToIndex) {
        enqueuePath(filePath, "low");
      }

      await sleep(0);
    }
  } finally {
    stopInitialScan();
    stopBaselineScan();
    baseline.markScanCompleted();
    updateBaselineActivity("indexing");
  }
}

export async function handleIgnoreChange(args: {
  rootPath: string;
  indexDatabase?: { listFiles: () => Array<{ path: string }>; deleteFile: (relPath: string) => void; getFile: (relPath: string) => any };
  shouldIgnore: (absolutePath: string) => boolean;
  resolveIgnoreScanBatchSize: () => number;
  yieldIfNeeded: (counter: { count: number }, batchSize: number) => Promise<void>;
  scanForNewFiles: () => Promise<string[]>;
  enqueuePath: (filePath: string, priority: "high" | "medium" | "low") => void;
  setActivity: (label: string, detail?: string) => void;
  clearActivity: (label?: string) => void;
}): Promise<void> {
  const {
    rootPath,
    indexDatabase,
    shouldIgnore,
    resolveIgnoreScanBatchSize,
    yieldIfNeeded,
    scanForNewFiles,
    enqueuePath,
    setActivity,
    clearActivity
  } = args;
  try {
    if (!indexDatabase) {
      console.warn("[IncrementalIndexer] IndexDatabase not provided; skipping gitignore reindex");
      return;
    }

    console.info("[IncrementalIndexer] Detected .gitignore change; re-evaluating indexed files...");
    setActivity("gitignore_reindex", "Re-evaluating ignore rules");

    const indexedFiles = indexDatabase.listFiles();
    const filesToRemove: string[] = [];
    const batchSize = resolveIgnoreScanBatchSize();
    const batchCounter = { count: 0 };

    for (const fileRecord of indexedFiles) {
      const absolutePath = path.join(rootPath, fileRecord.path);
      if (shouldIgnore(absolutePath)) {
        filesToRemove.push(fileRecord.path);
      }
      batchCounter.count += 1;
      await yieldIfNeeded(batchCounter, batchSize);
    }

    for (const relPath of filesToRemove) {
      try {
        indexDatabase.deleteFile(relPath);
        console.debug(`[IncrementalIndexer] Removed ignored file from index: ${relPath}`);
      } catch (error) {
        console.warn(`[IncrementalIndexer] Failed to remove ${relPath} from index:`, error);
      }
    }

    const newFiles = await scanForNewFiles();
    for (const filePath of newFiles) {
      enqueuePath(filePath, "high");
    }

    console.info(`[IncrementalIndexer] Gitignore reindex: removed ${filesToRemove.length} files, enqueued ${newFiles.length} new files`);
  } catch (error) {
    console.error("[IncrementalIndexer] Error handling .gitignore change:", error);
  } finally {
    clearActivity("gitignore_reindex");
  }
}

export async function scanForNewFiles(args: {
  rootPath: string;
  stopped: () => boolean;
  fileSystem: { readDir: (dir: string) => Promise<string[]>; stat: (path: string) => Promise<{ isDirectory(): boolean }> };
  symbolIndex: { isSupported: (filePath: string) => boolean };
  isDocumentFile: (filePath: string) => boolean;
  shouldIgnore: (absolutePath: string) => boolean;
  indexDatabase?: { getFile: (relPath: string) => any };
  resolveScanBatchSize: () => number;
  yieldIfNeeded: (counter: { count: number }, batchSize: number) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}): Promise<string[]> {
  const {
    rootPath,
    stopped,
    fileSystem,
    symbolIndex,
    isDocumentFile,
    shouldIgnore,
    indexDatabase,
    resolveScanBatchSize,
    yieldIfNeeded,
    sleep
  } = args;
  const stopIncremental = metrics.startTimer("indexer.incremental_scan_ms");
  const newFiles: string[] = [];
  const stack: string[] = [rootPath];
  const batchSize = resolveScanBatchSize();
  const batchCounter = { count: 0 };

  try {
    while (stack.length > 0 && !stopped()) {
      const current = stack.pop()!;
      let entries: string[];
      try {
        entries = await fileSystem.readDir(current);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry);
        if (shouldIgnore(fullPath)) continue;

        try {
          const stat = await fileSystem.stat(fullPath);
          if (stat.isDirectory()) {
            stack.push(fullPath);
          } else if (symbolIndex.isSupported(fullPath) || isDocumentFile(fullPath)) {
            const relPath = path.relative(rootPath, fullPath);
            const existing = indexDatabase?.getFile(relPath);
            if (!existing) {
              newFiles.push(fullPath);
            }
          }
        } catch {
          // ignore
        }
        batchCounter.count += 1;
        await yieldIfNeeded(batchCounter, batchSize);
      }
      await sleep(0);
    }
    return newFiles;
  } finally {
    stopIncremental();
  }
}

export async function yieldIfNeeded(counter: { count: number }, batchSize: number, sleep: (ms: number) => Promise<void>): Promise<void> {
  if (counter.count < batchSize) return;
  counter.count = 0;
  await sleep(0);
}
