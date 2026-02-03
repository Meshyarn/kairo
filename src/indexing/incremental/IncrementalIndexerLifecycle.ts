import chokidar from "chokidar";
import path from "path";
import type { ProjectIndex } from "../ProjectIndex.js";
import type { ProjectIndexManager } from "../ProjectIndexManager.js";
import type { IncrementalIndexerOptions } from "../IncrementalIndexerTypes.js";

export async function startIncrementalIndexer(args: {
  rootPath: string;
  started: boolean;
  setStarted: (value: boolean) => void;
  setStopped: (value: boolean) => void;
  indexManager: ProjectIndexManager;
  setCurrentIndex: (index: ProjectIndex) => void;
  restoreFromPersistedIndex: (index: ProjectIndex) => Promise<void>;
  options: IncrementalIndexerOptions;
  enqueueInitialScan: () => Promise<void>;
  setInitialScanPromise: (promise?: Promise<void>) => void;
  shouldIgnore: (watchedPath: string) => boolean;
  enqueuePath: (filePath: string, priority: "high" | "medium" | "low") => void;
  handleFileChange: (filePath: string) => Promise<void>;
  handleDeletion: (filePath: string) => Promise<void>;
  handleDirectoryDeletion: (dirPath: string) => Promise<void>;
  registerConfigurationEvents: () => void;
  startPeriodicPersistence: () => void;
  setWatcher: (watcher?: chokidar.FSWatcher) => void;
}): Promise<void> {
  const {
    rootPath,
    started,
    setStarted,
    setStopped,
    indexManager,
    setCurrentIndex,
    restoreFromPersistedIndex,
    options,
    enqueueInitialScan,
    setInitialScanPromise,
    shouldIgnore,
    enqueuePath,
    handleFileChange,
    handleDeletion,
    handleDirectoryDeletion,
    registerConfigurationEvents,
    startPeriodicPersistence,
    setWatcher
  } = args;

  if (started) {
    console.warn("[IncrementalIndexer] start() called while already running");
    return;
  }
  setStarted(true);
  setStopped(false);

  console.log("[IncrementalIndexer] Starting with persistent index support...");

  const existingIndex = await indexManager.loadPersistedIndex();
  if (existingIndex) {
    await restoreFromPersistedIndex(existingIndex);
    setCurrentIndex(existingIndex);
  } else {
    setCurrentIndex(indexManager.createEmptyIndex());
  }

  if (options.initialScan !== false) {
    setInitialScanPromise(enqueueInitialScan());
  }

  if (options.watch !== false) {
    const watcher = chokidar.watch(rootPath, {
      ignoreInitial: true,
      persistent: true,
      ignored: (watchedPath: string) => shouldIgnore(watchedPath),
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 150
      },
      atomic: true
    });

    watcher.add(path.join(rootPath, ".gitignore"));
    for (const file of ["tsconfig.json", "jsconfig.json", "package.json"]) {
      watcher.add(path.join(rootPath, file));
    }

    watcher.on("add", file => enqueuePath(file, "medium"));
    watcher.on("change", file => void handleFileChange(file));
    watcher.on("unlink", file => void handleDeletion(file));
    watcher.on("unlinkDir", dir => void handleDirectoryDeletion(dir));
    watcher.on("error", error => {
      console.warn("[IncrementalIndexer] watcher error", error);
    });

    setWatcher(watcher);
  }

  registerConfigurationEvents();
  startPeriodicPersistence();
}

export async function stopIncrementalIndexer(args: {
  setStopped: (value: boolean) => void;
  setStarted: (value: boolean) => void;
  unregisterConfigurationEvents: () => void;
  periodicPersistenceTimer?: NodeJS.Timeout;
  clearPersistenceTimer: () => void;
  processingPromise: Promise<void> | null;
  debouncedPersist?: { cancel: () => void };
  persistNow: (isFinal?: boolean) => Promise<void>;
  watcher?: chokidar.FSWatcher;
  indexDatabase?: { close?: () => void };
}): Promise<void> {
  const {
    setStopped,
    setStarted,
    unregisterConfigurationEvents,
    periodicPersistenceTimer,
    clearPersistenceTimer,
    processingPromise,
    debouncedPersist,
    persistNow,
    watcher,
    indexDatabase
  } = args;

  console.log("[IncrementalIndexer] Stop called");
  setStopped(true);
  setStarted(false);

  unregisterConfigurationEvents();

  if (periodicPersistenceTimer) {
    console.log("[IncrementalIndexer] Clearing persistence timer");
    clearPersistenceTimer();
  }

  if (processingPromise) {
    console.log("[IncrementalIndexer] Waiting for processingPromise to resolve...");
    await processingPromise;
    console.log("[IncrementalIndexer] processingPromise resolved");
  }

  if (debouncedPersist) {
    console.log("[IncrementalIndexer] Cancelling debounced persist");
    debouncedPersist.cancel();
  }

  await persistNow(true);

  if (watcher) {
    console.log("[IncrementalIndexer] Closing watcher");
    await watcher.close();
  }

  if (indexDatabase && typeof indexDatabase.close === "function") {
    console.log("[IncrementalIndexer] Closing database");
    indexDatabase.close();
  }
  console.log("[IncrementalIndexer] Stop complete");
}
