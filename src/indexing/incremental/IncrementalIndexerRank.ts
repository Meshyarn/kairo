import type { DependencyGraph } from "../../ast/DependencyGraph.js";

export async function resolveCallgraphRank(filePath: string, dependencyGraph: DependencyGraph): Promise<number> {
  try {
    const incoming = await dependencyGraph.getDependencies(filePath, "upstream");
    const outgoing = await dependencyGraph.getDependencies(filePath, "downstream");
    const total = incoming.length + outgoing.length;
    if (total <= 0) return 0;
    return Math.min(1, Math.log1p(total) / 4);
  } catch {
    return 0;
  }
}
