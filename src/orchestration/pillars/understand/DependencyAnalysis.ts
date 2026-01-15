import { OrchestrationContext } from "../../OrchestrationContext.js";
import { UnifiedContextGraph } from "../../context/UnifiedContextGraph.js";
import type { ProgressState } from "../../../utils/ProgressLogger.js";
import { resolveAdaptiveFlowLOD } from "../../adaptive-flow/AdaptiveFlowGate.js";

export type { ProgressState };
type RunTool = (context: OrchestrationContext, tool: string, args: any, progress?: ProgressState) => Promise<any>;

export function isDocumentPath(filePath: string): boolean {
  return /\.(md|mdx|txt|log|docx|xlsx|pdf)$/i.test(filePath);
}

export function isCodePath(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|cpp|cc|c|h|hpp|json|yml|yaml)$/i.test(filePath);
}

export function categorizeDocLinks(links: Array<{ resolvedPath?: string }>) {
  const docs: typeof links = [];
  const code: typeof links = [];
  const assets: typeof links = [];
  const external: typeof links = [];

  for (const link of links ?? []) {
    const resolved = link?.resolvedPath;
    if (!resolved) {
      external.push(link);
      continue;
    }
    if (isDocumentPath(resolved)) {
      docs.push(link);
      continue;
    }
    if (isCodePath(resolved)) {
      code.push(link);
      continue;
    }
    assets.push(link);
  }

  return { docs, code, assets, external };
}

export async function resolveCodeReferences(
  context: OrchestrationContext,
  refs: Array<{ resolvedPath?: string; href?: string }>,
  runTool: RunTool,
  progress?: ProgressState
): Promise<any[]> {
  const results: any[] = [];
  const limited = refs.filter(ref => ref?.resolvedPath).slice(0, 5);
  for (const ref of limited) {
    const resolvedPath = ref.resolvedPath as string;
    const ucg = context.getState<UnifiedContextGraph>('ucg');
    if (ucg) {
      const minLOD = resolveAdaptiveFlowLOD(context, 1);
      await ucg.ensureLOD({ path: resolvedPath, minLOD });
    }
    try {
      const match = await runTool(context, "project_search", {
        query: resolvedPath,
        type: "filename",
        maxResults: 1
      }, progress);
      const best = match?.results?.find((item: any) => item?.path === resolvedPath) ?? match?.results?.[0];
      results.push({
        path: resolvedPath,
        status: best ? "verified" : "unverified",
        match: best
      });
    } catch {
      results.push({ path: resolvedPath, status: "unverified" });
    }
  }
  return results;
}

export async function resolveMentionReferences(
  context: OrchestrationContext,
  mentions: Array<{ text: string; kind: "symbol" | "path"; line: number }>,
  runTool: RunTool,
  progress?: ProgressState
): Promise<any[]> {
  const results: any[] = [];
  const seen = new Set<string>();
  const limited = mentions.slice(0, 8);
  for (const mention of limited) {
    const key = `${mention.kind}:${mention.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (mention.kind === "path") {
      const ucg = context.getState<UnifiedContextGraph>('ucg');
      if (ucg) {
        const minLOD = resolveAdaptiveFlowLOD(context, 1);
        await ucg.ensureLOD({ path: mention.text, minLOD });
      }
    }
    try {
      const searchType = mention.kind === "path" ? "filename" : "symbol";
      const match = await runTool(context, "project_search", {
        query: mention.text,
        type: searchType,
        maxResults: 3
      }, progress);
      const best = match?.results?.[0];
      results.push({
        mention: mention.text,
        kind: mention.kind,
        line: mention.line,
        status: best ? "verified" : "unverified",
        match: best
      });
    } catch {
      results.push({
        mention: mention.text,
        kind: mention.kind,
        line: mention.line,
        status: "unverified"
      });
    }
  }
  return results;
}

export function mergeRelatedCode(primary?: any[], additional?: any[]): any[] | undefined {
  const combined = [...(primary ?? []), ...(additional ?? [])];
  if (combined.length === 0) return undefined;
  const seen = new Set<string>();
  return combined.filter((item: any) => {
    const key = item?.path ?? item?.match?.path ?? item?.mention ?? JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function collectDependenciesFromGraph(
  ucg: UnifiedContextGraph | undefined,
  filePath: string,
  context: OrchestrationContext
): Promise<{ success: boolean; edges: Array<{ from: string; to: string; type: string; metadata?: Record<string, unknown> }> } | undefined> {
  if (!ucg || !filePath) {
    return undefined;
  }

  try {
    const minLOD = resolveAdaptiveFlowLOD(context, 1);
    await ucg.ensureLOD({ path: filePath, minLOD });
  } catch (error) {
    console.debug("[UnderstandPillar] Failed to promote primary file for shared graph:", error);
    return undefined;
  }

  const node = ucg.getNode(filePath);
  if (!node) {
    return undefined;
  }

  const dependencies = [...node.dependencies];
  if (dependencies.length === 0) {
    return { success: true, edges: [] };
  }

  const dependencyLOD = resolveAdaptiveFlowLOD(context, 1);
  await Promise.all(dependencies.map(async (dep) => {
    try {
      await ucg.ensureLOD({ path: dep, minLOD: dependencyLOD });
    } catch {
      // Non-fatal: dependency remains but without enriched metadata
    }
  }));

  const edges = dependencies.map(dep => {
    const dependencyNode = ucg.getNode(dep);
    return {
      from: filePath,
      to: dep,
      type: "dependency",
      metadata: dependencyNode?.topology
        ? { topology: dependencyNode.topology, lod: dependencyNode.lod }
        : undefined
    };
  });

  return { success: true, edges };
}
