import type { IndexingActivity } from "./IndexStateManager.js";
import type { NativeSearchIndexer } from "../engine/search/native/NativeSearchIndexer.js";
import type { IFileSystem } from "../platform/FileSystem.js";

export interface IncrementalIndexerOptions {
  watch?: boolean;
  initialScan?: boolean;
  batchPauseMs?: number;
  statConcurrency?: number;
  fileSystem?: IFileSystem;
  onFileQueued?: (filePath: string) => void;
  onFileIndexed?: (filePath: string) => void;
  onFileRemoved?: (filePath: string) => void;
  onDirectoryRemoved?: (dirPath: string) => void;
  onActivity?: (activity?: IndexingActivity) => void;
  nativeSearchIndexer?: NativeSearchIndexer;
  repoId?: string;
}

export interface IndexerStatusSnapshot {
  queueDepth: { high: number; medium: number; low: number; total: number };
  currentPauseMs: number;
  maxQueueDepthSeen: number;
  processing: boolean;
  activity?: {
    label: string;
    detail?: string;
    startedAt: string;
  };
}
