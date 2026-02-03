import type { SymbolIndex } from "../../ast/SymbolIndex.js";
import type { DependencyGraph } from "../../ast/DependencyGraph.js";
import type { DocumentIndexer } from "../DocumentIndexer.js";
import type { ProjectIndexManager } from "../ProjectIndexManager.js";
import type { ProjectIndex } from "../ProjectIndex.js";
import type { IndexDatabase } from "../IndexDatabase.js";
import type { NativeSearchIndexer } from "../../engine/search/native/NativeSearchIndexer.js";
import { handleDeletion, handleDirectoryDeletion } from "./IncrementalIndexerDeletion.js";

export async function handleFileDeletionFlow(args: {
  rootPath: string;
  repoId: string;
  filePath: string;
  isWithinRoot: (target: string) => boolean;
  removeFromQueues: (target: string) => void;
  isDocumentFile: (target: string) => boolean;
  documentIndexer?: DocumentIndexer;
  symbolIndex: SymbolIndex;
  nativeSearchIndexer?: NativeSearchIndexer;
  indexDatabase?: IndexDatabase;
  dependencyGraph: DependencyGraph;
  currentIndex: ProjectIndex | null;
  indexManager: ProjectIndexManager;
  debouncedPersist: () => void;
  onFileRemoved?: (filePath: string) => void;
}): Promise<void> {
  await handleDeletion(args);
}

export async function handleDirectoryDeletionFlow(args: {
  rootPath: string;
  repoId: string;
  dirPath: string;
  isWithinRoot: (target: string) => boolean;
  removeMatchingFromQueues: (predicate: (path: string) => boolean) => void;
  indexDatabase?: IndexDatabase;
  documentIndexer?: DocumentIndexer;
  nativeSearchIndexer?: NativeSearchIndexer;
  currentIndex: ProjectIndex | null;
  indexManager: ProjectIndexManager;
  dependencyGraph: DependencyGraph;
  debouncedPersist: () => void;
  onDirectoryRemoved?: (dirPath: string) => void;
}): Promise<void> {
  await handleDirectoryDeletion(args);
}
