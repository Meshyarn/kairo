import { OrchestrationContext } from "../../OrchestrationContext.js";
import { UnifiedContextGraph } from "../../context/UnifiedContextGraph.js";
import { NodeFileSystem } from "../../../platform/FileSystem.js";
import { EditorEngine } from "../../../engine/Editor.js";
import { SkeletonGenerator } from "../../../ast/SkeletonGenerator.js";
import { SymbolIndex } from "../../../ast/SymbolIndex.js";
import { ModuleResolver } from "../../../ast/ModuleResolver.js";
import { CallGraphBuilder } from "../../../ast/CallGraphBuilder.js";
import { AstDiffEngine } from "../../../ast/AstDiffEngine.js";
import { SymbolImpactAnalyzer, type SymbolImpactRequest, type SymbolImpactResult } from "../../../engine/SymbolImpactAnalyzer.js";
import { AutoRepairSuggester } from "../../../engine/AutoRepairSuggester.js";

export function toImpactReport(impact: any, deps: any, targetPath: string, hotSpots: any, crossLangImpact?: any) {
  if (!impact) return undefined;
  const suggestedTests = Array.isArray(impact.suggestedTests) ? impact.suggestedTests : [];
  const testPriority = new Map(suggestedTests.map((t: string) => [t, 'important' as const]));
  const impacted = Array.isArray(impact?.summary?.impactedFiles) ? impact.summary.impactedFiles : [];
  const pageRankDelta = computePageRankDelta(deps, [targetPath, ...impacted]);
  const impactedSet = new Set([targetPath, ...impacted].filter(Boolean));
  const affectedHotSpots = Array.isArray(hotSpots)
    ? hotSpots.filter((spot: any) => impactedSet.has(spot?.filePath))
    : [];
  return {
    preview: impact,
    affectedHotSpots,
    pageRankDelta,
    breakingChangeRisk: impact.riskLevel ?? 'low',
    suggestedTests,
    testPriority,
    crossLangImpact
  };
}

export function computePageRankDelta(deps: any, impactedFiles: string[]): Map<string, number> {
  const edges = Array.isArray(deps?.edges) ? deps.edges : [];
  if (edges.length === 0 || impactedFiles.length === 0) return new Map();
  const baseline = computePageRankFromEdges(edges);
  const impactedSet = new Set(impactedFiles.filter(Boolean));
  const filtered = edges.filter((edge: any) => impactedSet.has(edge.source ?? edge.from) && impactedSet.has(edge.target ?? edge.to));
  const scoped = computePageRankFromEdges(filtered);
  const delta = new Map<string, number>();
  for (const file of impactedSet) {
    const base = baseline.get(file) ?? 0;
    const next = scoped.get(file) ?? 0;
    delta.set(file, Number((next - base).toFixed(6)));
  }
  return delta;
}

export function computePageRankFromEdges(edges: Array<{ source?: string; target?: string; from?: string; to?: string }>): Map<string, number> {
  const normalized = edges
    .map(edge => ({ from: edge.from ?? edge.source, to: edge.to ?? edge.target }))
    .filter(edge => edge.from && edge.to) as Array<{ from: string; to: string }>;
  if (normalized.length === 0) return new Map();

  const nodes = new Set<string>();
  for (const edge of normalized) {
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  const ids = Array.from(nodes);
  const n = ids.length;
  if (n === 0) return new Map();

  const outgoing = new Map<string, string[]>();
  for (const id of ids) outgoing.set(id, []);
  for (const edge of normalized) {
    outgoing.get(edge.from)!.push(edge.to);
  }

  const damping = 0.85;
  let ranks = new Map<string, number>(ids.map(id => [id, 1 / n]));
  for (let iter = 0; iter < 12; iter++) {
    const next = new Map<string, number>(ids.map(id => [id, (1 - damping) / n]));
    for (const id of ids) {
      const outs = outgoing.get(id) ?? [];
      const share = (ranks.get(id) ?? 0) / (outs.length || n);
      if (outs.length === 0) {
        for (const other of ids) {
          next.set(other, (next.get(other) ?? 0) + damping * share);
        }
      } else {
        for (const to of outs) {
          next.set(to, (next.get(to) ?? 0) + damping * share);
        }
      }
    }
    ranks = next;
  }

  return ranks;
}

export async function collectDependentsFromGraph(
  ucg: UnifiedContextGraph | undefined,
  targetPath: string | undefined
): Promise<{ success: boolean; edges: Array<{ from: string; to: string; type: string; metadata?: Record<string, unknown> }> } | undefined> {
  if (!ucg || !targetPath) {
    return undefined;
  }

  try {
    await ucg.ensureLOD({ path: targetPath, minLOD: 1 });
  } catch (error) {
    console.debug('[ChangePillar] Failed to promote target for shared graph impact:', error);
    return undefined;
  }

  const node = ucg.getNode(targetPath);
  if (!node) {
    return undefined;
  }

  const dependents = [...node.dependents];
  if (dependents.length === 0) {
    return { success: true, edges: [] };
  }

  await Promise.all(dependents.map(async (dep) => {
    try {
      await ucg.ensureLOD({ path: dep, minLOD: 1 });
    } catch {
      // Missing metadata is acceptable
    }
  }));

  const edges = dependents.map(dep => {
    const dependentNode = ucg.getNode(dep);
    return {
      from: dep,
      to: targetPath,
      type: 'dependency',
      metadata: dependentNode?.topology
        ? {
            topology: dependentNode.topology,
            lod: dependentNode.lod,
            symbols: dependentNode.topology.topLevelSymbols?.map((symbol: any) => symbol.name).slice(0, 5)
          }
        : undefined
    };
  });

  return { success: true, edges };
}

export async function analyzeSymbolImpact(
  filePath: string,
  edits: any[],
  constraints: any,
  fileSystem: NodeFileSystem
): Promise<SymbolImpactResult | null> {
  try {
    const currentContent = await fileSystem.readFile(filePath);
    const editorEngine = new EditorEngine(process.cwd(), fileSystem);
    let newContent = currentContent;
    
    for (const edit of edits) {
      if (edit.targetString && edit.replacementString) {
        newContent = newContent.replace(edit.targetString, edit.replacementString);
      }
    }
    
    const rootPath = process.cwd();
    const skeletonGenerator = new SkeletonGenerator();
    const symbolIndex = new SymbolIndex(rootPath, skeletonGenerator, []);
    const moduleResolver = new ModuleResolver(rootPath);
    const callGraphBuilder = new CallGraphBuilder(rootPath, symbolIndex, moduleResolver);
    const astDiffEngine = new AstDiffEngine();
    
    const symbolImpactAnalyzer = new SymbolImpactAnalyzer(
      symbolIndex,
      callGraphBuilder,
      astDiffEngine
    );
    
    const request: SymbolImpactRequest = {
      filePath,
      oldContent: currentContent,
      newContent,
      maxDepth: constraints.symbolImpactDepth || 3
    };
    
    const result = await symbolImpactAnalyzer.analyzeImpact(request);
    
    const hasBreaking = result.astChanges.some((c: any) => c.isBreaking);
    if (hasBreaking && result.impactedSymbols.length > 0) {
      const autoRepairSuggester = new AutoRepairSuggester();
      const repairResult = await autoRepairSuggester.suggestRepairs(
        result.astChanges,
        result.impactedSymbols
      );
      
      (result as any).suggestedEdits = repairResult.suggestedEdits;
    }
    
    return result;
    
  } catch (error) {
    console.warn('Symbol impact analysis failed:', error);
    return null;
  }
}
