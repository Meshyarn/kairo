import path from "path";
import type { DependencyGraph } from "../../ast/DependencyGraph.js";
import type { ModuleResolver } from "../../ast/ModuleResolver.js";

export async function handleModuleConfigChange(args: {
  filePath: string;
  moduleResolver?: ModuleResolver;
  dependencyGraph: DependencyGraph;
  getReloadPromise: () => Promise<void> | undefined;
  setReloadPromise: (promise?: Promise<void>) => void;
  setActivity: (label: string, detail?: string) => void;
  clearActivity: (label?: string) => void;
}): Promise<void> {
  const {
    filePath,
    moduleResolver,
    dependencyGraph,
    getReloadPromise,
    setReloadPromise,
    setActivity,
    clearActivity
  } = args;

  if (!moduleResolver) {
    console.warn("[IncrementalIndexer] ModuleResolver not provided; skipping config reload");
    return;
  }

  if (getReloadPromise()) {
    return;
  }

  const promise = performModuleConfigReload({
    filePath,
    moduleResolver,
    dependencyGraph,
    setActivity,
    clearActivity
  }).finally(() => {
    setReloadPromise(undefined);
  });

  setReloadPromise(promise);
}

async function performModuleConfigReload(args: {
  filePath: string;
  moduleResolver: ModuleResolver;
  dependencyGraph: DependencyGraph;
  setActivity: (label: string, detail?: string) => void;
  clearActivity: (label?: string) => void;
}): Promise<void> {
  const { filePath, moduleResolver, dependencyGraph, setActivity, clearActivity } = args;
  const basename = path.basename(filePath);
  console.info(`[IncrementalIndexer] Detected configuration change (${basename}); reloading module resolver and rebuilding unresolved dependencies...`);
  setActivity("config_reload", `Reloading configuration from ${basename}`);
  try {
    moduleResolver.reloadConfig();
    await dependencyGraph.rebuildUnresolved();
    console.info("[IncrementalIndexer] Configuration reload complete.");
  } catch (error) {
    console.error("[IncrementalIndexer] Error handling configuration change:", error);
  } finally {
    clearActivity("config_reload");
  }
}
