import * as path from "path";

export async function handleDeletion(args: {
  rootPath: string;
  repoId: string;
  filePath: string;
  isWithinRoot: (filePath: string) => boolean;
  removeFromQueues: (filePath: string) => void;
  isDocumentFile: (filePath: string) => boolean;
  documentIndexer?: { deleteFile: (filePath: string) => void };
  symbolIndex: { isSupported: (filePath: string) => boolean };
  nativeSearchIndexer?: { deleteCodeFile: (repoId: string, filePath: string) => void };
  indexDatabase?: { readSymbols: (relPath: string) => any[] | undefined; addGhost: (ghost: any) => void };
  dependencyGraph: { removeFile: (filePath: string) => Promise<void> };
  currentIndex: any;
  indexManager: { removeFileEntry: (index: any, filePath: string) => void };
  debouncedPersist: () => void;
  onFileRemoved?: (filePath: string) => void;
}): Promise<void> {
  const {
    rootPath,
    repoId,
    isWithinRoot,
    removeFromQueues,
    isDocumentFile,
    documentIndexer,
    symbolIndex,
    nativeSearchIndexer,
    indexDatabase,
    dependencyGraph,
    currentIndex,
    indexManager,
    debouncedPersist,
    onFileRemoved
  } = args;
  try {
    if (!isWithinRoot(args.filePath)) return;
    const absolutePath = path.resolve(args.filePath);
    removeFromQueues(absolutePath);

    if (isDocumentFile(args.filePath)) {
      documentIndexer?.deleteFile(args.filePath);
    }
    if (symbolIndex.isSupported(args.filePath)) {
      const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");
      nativeSearchIndexer?.deleteCodeFile(repoId, relativePath);
    }

    if (indexDatabase) {
      const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");
      const symbols = indexDatabase.readSymbols(relativePath);
      if (symbols && symbols.length > 0) {
        for (const symbol of symbols) {
          indexDatabase.addGhost({
            name: symbol.name,
            lastSeenPath: relativePath,
            type: symbol.type,
            lastKnownSignature: "signature" in symbol ? symbol.signature : undefined,
            deletedAt: Date.now()
          });
        }
      }
    }

    await dependencyGraph.removeFile(args.filePath);

    if (currentIndex) {
      indexManager.removeFileEntry(currentIndex, args.filePath);
      debouncedPersist();
    }

    onFileRemoved?.(absolutePath);
  } catch (error) {
    console.warn(`[IncrementalIndexer] failed to remove ${args.rootPath}:`, error);
  }
}

export async function handleDirectoryDeletion(args: {
  rootPath: string;
  repoId: string;
  dirPath: string;
  isWithinRoot: (filePath: string) => boolean;
  removeMatchingFromQueues: (predicate: (path: string) => boolean) => void;
  indexDatabase?: { listFiles: () => Array<{ path: string }>; deleteFile: (relPath: string) => void };
  documentIndexer?: { isSupported: (relPath: string) => boolean; deleteFile: (relPath: string) => void };
  nativeSearchIndexer?: { deleteCodeFile: (repoId: string, relPath: string) => void; flush?: () => void };
  currentIndex: any;
  indexManager: { removeFileEntry: (index: any, filePath: string) => void };
  dependencyGraph: { removeDirectory: (dirPath: string) => Promise<void> };
  debouncedPersist: () => void;
  onDirectoryRemoved?: (dirPath: string) => void;
}): Promise<void> {
  const {
    rootPath,
    repoId,
    dirPath,
    isWithinRoot,
    removeMatchingFromQueues,
    indexDatabase,
    documentIndexer,
    nativeSearchIndexer,
    currentIndex,
    indexManager,
    dependencyGraph,
    debouncedPersist,
    onDirectoryRemoved
  } = args;
  try {
    if (!isWithinRoot(dirPath)) return;
    const normalizedDir = path.resolve(dirPath);
    removeMatchingFromQueues((queued) => queued.startsWith(normalizedDir));

    if (indexDatabase) {
      const relativePrefixRaw = path.relative(rootPath, normalizedDir).replace(/\\/g, "/");
      const relativePrefix = relativePrefixRaw === "." ? "" : (relativePrefixRaw.endsWith("/") ? relativePrefixRaw : `${relativePrefixRaw}/`);
      const deletedPaths = indexDatabase
        .listFiles()
        .map((record) => record.path)
        .filter((recordPath) => recordPath === relativePrefixRaw || recordPath.startsWith(relativePrefix));

      for (const relPath of deletedPaths) {
        if (documentIndexer && documentIndexer.isSupported(relPath)) {
          documentIndexer.deleteFile(relPath);
        } else {
          nativeSearchIndexer?.deleteCodeFile(repoId, relPath);
          indexDatabase.deleteFile(relPath);
        }

        if (currentIndex) {
          const absPath = path.resolve(rootPath, relPath);
          indexManager.removeFileEntry(currentIndex, absPath);
        }
      }

      nativeSearchIndexer?.flush?.();
      if (currentIndex && deletedPaths.length > 0) {
        debouncedPersist();
      }
    }

    await dependencyGraph.removeDirectory(dirPath);
    onDirectoryRemoved?.(normalizedDir);
  } catch (error) {
    console.warn(`[IncrementalIndexer] failed to remove directory ${dirPath}:`, error);
  }
}
