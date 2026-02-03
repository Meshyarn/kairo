import type { SymbolIndex } from "../../ast/SymbolIndex.js";
import type { DependencyGraph } from "../../ast/DependencyGraph.js";
import type { ProjectIndex } from "../ProjectIndex.js";

export async function restoreFromPersistedIndex(args: {
  index: ProjectIndex;
  symbolIndex: SymbolIndex;
  dependencyGraph: DependencyGraph;
}): Promise<void> {
  const { index, symbolIndex, dependencyGraph } = args;
  console.log(`[IncrementalIndexer] Restoring from persisted index (${Object.keys(index.files).length} files)...`);

  const restorePromises = Object.entries(index.files).map(([filePath, entry]) => {
    const resolvedEdges = entry.imports
      ?.filter(imp => !!imp.resolvedPath)
      .map(imp => ({
        from: filePath,
        to: imp.resolvedPath!,
        type: "import" as const,
        what: imp.what.join(", "),
        line: imp.line
      })) ?? [];

    return Promise.all([
      Promise.resolve(symbolIndex.restoreFromCache(filePath, entry.symbols, entry.mtime)),
      resolvedEdges.length > 0
        ? dependencyGraph.restoreEdges(filePath, resolvedEdges)
        : Promise.resolve()
    ]);
  });

  await Promise.all(restorePromises);

  console.log("[IncrementalIndexer] Restore complete");
}
