import type { IFileSystem } from "../../platform/FileSystem.js";
import type { SymbolIndex } from "../../ast/SymbolIndex.js";
import { enqueueInitialScan } from "./IncrementalIndexerScan.js";

export async function runInitialScan(args: {
  rootPath: string;
  stopped: () => boolean;
  fileSystem: IFileSystem;
  symbolIndex: SymbolIndex;
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
  await enqueueInitialScan(args);
}
