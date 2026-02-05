import path from "path";
import type { SymbolIndex } from "../../ast/SymbolIndex.js";
import type { AstManager } from "../../ast/AstManager.js";
import type { DependencyGraph } from "../../ast/DependencyGraph.js";
import type { IFileSystem } from "../../platform/FileSystem.js";
import type { NativeSearchIndexer } from "../../engine/search/native/NativeSearchIndexer.js";
import type { ProjectIndexManager } from "../ProjectIndexManager.js";
import type { ProjectIndex, FileIndexEntry } from "../ProjectIndex.js";
import type { DocumentIndexer } from "../DocumentIndexer.js";
import type { IncrementalIndexerOptions } from "../IncrementalIndexerTypes.js";
import { FeatureFlags } from "../../config/FeatureFlags.js";
import { metrics } from "../../utils/MetricsCollector.js";
import { hashContent } from "../../utils/hash.js";

export async function processQueue(args: {
  options: IncrementalIndexerOptions;
  isStopped: () => boolean;
  isProcessing: () => boolean;
  setProcessing: (value: boolean) => void;
  getTotalQueueSize: () => number;
  pullNextBatch: () => string[];
  getCurrentPauseMs: () => number;
  sleep: (ms: number) => Promise<void>;
  setActivity: (label: string, detail?: string) => void;
  clearActivity: (label?: string) => void;
  fileExists: (filePath: string) => Promise<boolean>;
  isDocumentFile: (filePath: string) => boolean;
  documentIndexer?: DocumentIndexer;
  currentIndex: ProjectIndex | null;
  fileSystem: IFileSystem;
  symbolIndex: SymbolIndex;
  astManager: AstManager;
  unifiedExtractor: { extractImports: (...args: any[]) => Promise<any[]>; extractExports: (...args: any[]) => Promise<any[]>; supportsRegex: (languageId: string) => boolean };
  dependencyGraph: DependencyGraph;
  indexManager: ProjectIndexManager;
  indexDatabase?: { updateFileMeta?: (...args: any[]) => void };
  nativeSearchIndexer?: NativeSearchIndexer;
  rootPath: string;
  repoId: string;
  resolveCallgraphRank: (filePath: string) => Promise<number>;
  ensureAstManagerReady: () => Promise<void>;
  updateBaselineActivity: (phase: "scanning" | "indexing") => void;
  baseline: {
    isActive: () => boolean;
    isScanCompleted: () => boolean;
    markProcessed: () => void;
    completeIfIdle: () => void;
  };
  debouncedPersist: () => void;
}): Promise<void> {
  const {
    options,
    isStopped,
    isProcessing,
    setProcessing,
    getTotalQueueSize,
    pullNextBatch,
    getCurrentPauseMs,
    sleep,
    setActivity,
    clearActivity,
    fileExists,
    isDocumentFile,
    documentIndexer,
    currentIndex,
    fileSystem,
    symbolIndex,
    astManager,
    unifiedExtractor,
    dependencyGraph,
    indexManager,
    indexDatabase,
    nativeSearchIndexer,
    rootPath,
    repoId,
    resolveCallgraphRank,
    ensureAstManagerReady,
    updateBaselineActivity,
    baseline,
    debouncedPersist
  } = args;

  if (isProcessing() || isStopped()) return;
  setProcessing(true);

  while (getTotalQueueSize() > 0 && !isStopped()) {
    const batchDelay = Math.max(options.batchPauseMs ?? getCurrentPauseMs(), 50);
    await sleep(batchDelay);
    setActivity("queue_processing", `Processing ${getTotalQueueSize()} queued files`);

    const batchEntries = pullNextBatch();

    const PARALLEL_LIMIT = 8;
    for (let i = 0; i < batchEntries.length; i += PARALLEL_LIMIT) {
      const chunk = batchEntries.slice(i, i + PARALLEL_LIMIT);
      await Promise.all(chunk.map(async (filePath) => {
        if (isStopped()) {
          return;
        }
        if (!(await fileExists(filePath))) {
          return;
        }
        const isDocFile = isDocumentFile(filePath);

        const stopBaselineIndex = baseline.isActive() ? metrics.startTimer("baseline.index_ms") : null;
        try {
          if (isDocFile && documentIndexer) {
            await documentIndexer.indexFile(filePath, { force: true });
            if (currentIndex && !isStopped()) {
              const stat = await fileSystem.stat(filePath).catch(() => undefined);
              if (stat) {
                const entry: FileIndexEntry = {
                  mtime: stat.mtime,
                  symbols: [],
                  imports: [],
                  exports: []
                };
                indexManager.updateFileEntry(currentIndex, filePath, entry);
              }
            }
            options.onFileIndexed?.(filePath);
            if (baseline.isActive()) {
              baseline.markProcessed();
              updateBaselineActivity("indexing");
            }
            return;
          }
          const symbols = await symbolIndex.getSymbolsForFile(filePath);
          const content = await fileSystem.readFile(filePath);
          const languageId = astManager.getLanguageId(filePath);
          let doc: any;
          try {
            const unifiedEnabled = FeatureFlags.isEnabled(FeatureFlags.UNIFIED_EXTRACTION_ENABLED, FeatureFlags.getContext());
            const shouldParseDoc = !unifiedEnabled || !unifiedExtractor.supportsRegex(languageId);
            if (shouldParseDoc) {
              await ensureAstManagerReady();
              doc = await astManager.parseFile(filePath, content);
            }
            const [imports, exports] = await Promise.all([
              unifiedExtractor.extractImports(filePath, content, languageId, { doc }),
              unifiedExtractor.extractExports(filePath, content, languageId, { doc })
            ]);

            await dependencyGraph.updateFileDependencies(filePath);

            if (currentIndex && !isStopped()) {
              const stat = await fileSystem.stat(filePath).catch(() => undefined);
              if (stat) {
                const contentHash = hashContent(content);
                const callgraphRank = await resolveCallgraphRank(filePath);
                const entry: FileIndexEntry = {
                  mtime: stat.mtime,
                  symbols,
                  imports,
                  exports
                };
                indexManager.updateFileEntry(currentIndex, filePath, entry);
                if (indexDatabase) {
                  const relPath = path.relative(rootPath, filePath).replace(/\\/g, "/");
                  indexDatabase.updateFileMeta?.(relPath, {
                    lastModified: stat.mtime,
                    contentHash,
                    sizeBytes: stat.size
                  });
                }
                if (nativeSearchIndexer) {
                  const relPath = path.relative(rootPath, filePath).replace(/\\/g, "/");
                  nativeSearchIndexer.upsertCodeFile({
                    repoId,
                    filePath: relPath,
                    content,
                    contentHash,
                    mtimeMs: stat.mtime,
                    symbols,
                    callgraphRank
                  });
                }
              }
            }
          } finally {
            doc?.dispose?.();
          }
          options.onFileIndexed?.(filePath);
          if (baseline.isActive()) {
            baseline.markProcessed();
            updateBaselineActivity("indexing");
          }
        } catch (error) {
          console.warn(`[IncrementalIndexer] failed to index ${filePath}:`, error);
        } finally {
          if (stopBaselineIndex) stopBaselineIndex();
        }
      }));
    }

    debouncedPersist();
  }

  clearActivity("queue_processing");
  if (baseline.isActive() && baseline.isScanCompleted() && getTotalQueueSize() === 0) {
    baseline.completeIfIdle();
  }
  setProcessing(false);
}
