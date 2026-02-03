import path from "path";
import type { PriorityLevel } from "./IncrementalIndexerQueueState.js";
import { handleIgnoreChange as handleIgnoreChangeCore, scanForNewFiles as scanForNewFilesCore, yieldIfNeeded } from "./IncrementalIndexerScan.js";

export async function handleFileChangeEvent(args: {
  filePath: string;
  ignoreFileName: string;
  configFiles: string[];
  onIgnoreChange: () => Promise<void>;
  onConfigChange: (filePath: string) => Promise<void>;
  enqueuePath: (filePath: string, priority: PriorityLevel) => void;
}): Promise<void> {
  const { filePath, ignoreFileName, configFiles, onIgnoreChange, onConfigChange, enqueuePath } = args;
  const basename = path.basename(filePath);

  if (basename === ignoreFileName) {
    await onIgnoreChange();
    return;
  }

  if (configFiles.includes(basename)) {
    await onConfigChange(filePath);
  }

  enqueuePath(filePath, "medium");
}

export async function handleIgnoreChangeEvent(args: {
  rootPath: string;
  indexDatabase?: { listFiles: () => Array<{ path: string }>; deleteFile: (relPath: string) => void; getFile: (relPath: string) => any };
  shouldIgnore: (absolutePath: string) => boolean;
  resolveIgnoreScanBatchSize: () => number;
  enqueuePath: (filePath: string, priority: PriorityLevel) => void;
  setActivity: (label: string, detail?: string) => void;
  clearActivity: (label?: string) => void;
  stopped: () => boolean;
  fileSystem: { readDir: (dir: string) => Promise<string[]>; stat: (path: string) => Promise<{ isDirectory(): boolean }> };
  symbolIndex: { isSupported: (filePath: string) => boolean };
  isDocumentFile: (filePath: string) => boolean;
  resolveScanBatchSize: () => number;
  sleep: (ms: number) => Promise<void>;
}): Promise<void> {
  const { rootPath, stopped, fileSystem, symbolIndex, isDocumentFile, shouldIgnore, indexDatabase, resolveScanBatchSize, sleep, ...rest } = args;
  const scanForNewFiles = () => scanForNewFilesCore({
    rootPath,
    stopped,
    fileSystem,
    symbolIndex,
    isDocumentFile,
    shouldIgnore,
    indexDatabase,
    resolveScanBatchSize,
    sleep,
    yieldIfNeeded: (counter, batchSize) => yieldIfNeeded(counter, batchSize, sleep)
  });

  await handleIgnoreChangeCore({
    rootPath,
    indexDatabase,
    shouldIgnore,
    resolveIgnoreScanBatchSize: rest.resolveIgnoreScanBatchSize,
    enqueuePath: rest.enqueuePath,
    setActivity: rest.setActivity,
    clearActivity: rest.clearActivity,
    yieldIfNeeded: (counter, batchSize) => yieldIfNeeded(counter, batchSize, sleep),
    scanForNewFiles
  });
}
