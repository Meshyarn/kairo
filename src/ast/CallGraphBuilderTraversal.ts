import type { CallGraphNode } from "../types.js";
import type {
  CallGraphBudget,
  DefinitionLocation,
  FileSymbolContext,
  GlobalIndexData,
  ResolvedCallTarget
} from "./CallGraphBuilderTypes.js";

type TraversalContext = {
  resolveCallTargets: (
    call: any,
    context: FileSymbolContext,
    definitionRegistryProvider?: () => Promise<Map<string, DefinitionLocation[]>>
  ) => Promise<ResolvedCallTarget[]>;
  getFileContext: (absPath: string) => Promise<FileSymbolContext | null>;
  makeSymbolId: (filePath: string, symbolName: string) => string;
  getOrCreateNodeWithBudget: (
    symbolId: string,
    definition: any,
    relativePath: string,
    visitedNodes: Record<string, CallGraphNode>,
    budget?: CallGraphBudget
  ) => CallGraphNode | null;
  addEdge: (
    fromNode: CallGraphNode,
    toNode: CallGraphNode,
    edge: { callType: any; confidence: any; line: number; column: number },
    budget?: CallGraphBudget
  ) => boolean;
  enqueueNode: (
    symbolId: string,
    depth: number,
    maxDepth: number,
    queue: Array<{ symbolId: string; depth: number }>,
    depthBySymbol: Map<string, number>,
    processed: Set<string>
  ) => void;
};

export const populateDownstream = async (ctx: TraversalContext, params: {
  node: CallGraphNode;
  location: DefinitionLocation;
  depth: number;
  maxDepth: number;
  visitedNodes: Record<string, CallGraphNode>;
  definitionCache: Map<string, DefinitionLocation>;
  queue: Array<{ symbolId: string; depth: number }>;
  depthBySymbol: Map<string, number>;
  processed: Set<string>;
  budget?: CallGraphBudget;
  getGlobalDefinitions?: () => Promise<Map<string, DefinitionLocation[]>>;
}): Promise<{ truncated: boolean; truncatedReason?: "cap" | "depth" | "unknown" }> => {
  const { node, location, depth, maxDepth, visitedNodes, definitionCache, queue, depthBySymbol, processed, budget } = params;
  const definition = location.definition;
  if (!definition.calls || definition.calls.length === 0) {
    return { truncated: false };
  }

  if (depth >= maxDepth) {
    return { truncated: true, truncatedReason: "depth" };
  }

  const context = await ctx.getFileContext(location.absPath);
  if (!context) {
    return { truncated: true, truncatedReason: "unknown" };
  }

  let truncated = false;
  let truncatedReason: "cap" | "depth" | "unknown" | undefined;
  for (const call of definition.calls) {
    if (budget?.exhausted) {
      truncated = true;
      truncatedReason = truncatedReason ?? "cap";
      break;
    }
    const targets = await ctx.resolveCallTargets(call, context, params.getGlobalDefinitions);
    if (targets.length === 0) {
      truncated = true;
      truncatedReason = truncatedReason ?? "unknown";
      continue;
    }

    for (const target of targets) {
      if (budget?.exhausted) {
        truncated = true;
        truncatedReason = truncatedReason ?? "cap";
        break;
      }
      const nextDepth = depth + 1;
      if (nextDepth > maxDepth) {
        truncated = true;
        truncatedReason = truncatedReason ?? "depth";
        continue;
      }

      const symbolId = ctx.makeSymbolId(target.relativePath, target.definition.name);
      const calleeNode = ctx.getOrCreateNodeWithBudget(symbolId, target.definition, target.relativePath, visitedNodes, budget);
      if (!calleeNode) {
        truncated = true;
        truncatedReason = truncatedReason ?? "cap";
        continue;
      }
      if (!definitionCache.has(symbolId)) {
        definitionCache.set(symbolId, target);
      }

      const added = ctx.addEdge(node, calleeNode, {
        callType: call.callType,
        confidence: target.confidence,
        line: typeof call.line === "number" ? call.line : 0,
        column: typeof call.column === "number" ? call.column : 0
      }, budget);
      if (!added && budget?.exhausted) {
        truncated = true;
        truncatedReason = truncatedReason ?? "cap";
        break;
      }

      ctx.enqueueNode(symbolId, nextDepth, maxDepth, queue, depthBySymbol, processed);
    }
  }

  return { truncated, ...(truncatedReason ? { truncatedReason } : {}) };
};

export const populateUpstream = async (ctx: TraversalContext, params: {
  node: CallGraphNode;
  location: DefinitionLocation;
  depth: number;
  maxDepth: number;
  visitedNodes: Record<string, CallGraphNode>;
  definitionCache: Map<string, DefinitionLocation>;
  queue: Array<{ symbolId: string; depth: number }>;
  depthBySymbol: Map<string, number>;
  processed: Set<string>;
  budget?: CallGraphBudget;
  getGlobalData: () => Promise<GlobalIndexData>;
}): Promise<{ truncated: boolean; truncatedReason?: "cap" | "depth" | "unknown" }> => {
  const { node, location, depth, maxDepth, visitedNodes, definitionCache, queue, depthBySymbol, processed, budget } = params;
  const globalData = await params.getGlobalData();
  const candidates = globalData.callSitesByName.get(location.definition.name);
  if (!candidates || candidates.length === 0) {
    return { truncated: false };
  }

  if (depth >= maxDepth) {
    return { truncated: true, truncatedReason: "depth" };
  }

  let truncated = false;
  let truncatedReason: "cap" | "depth" | "unknown" | undefined;
  for (const site of candidates) {
    if (budget?.exhausted) {
      truncated = true;
      truncatedReason = truncatedReason ?? "cap";
      break;
    }
    const resolvedTargets = await ctx.resolveCallTargets(site.call, site.context, async () => globalData.definitionsByName);
    const match = resolvedTargets.find(target =>
      target.relativePath === location.relativePath &&
      target.definition.name === location.definition.name
    );
    if (!match) {
      continue;
    }

    const nextDepth = depth + 1;
    if (nextDepth > maxDepth) {
      truncated = true;
      truncatedReason = truncatedReason ?? "depth";
      continue;
    }

    const callerId = ctx.makeSymbolId(site.context.relativePath, site.definition.name);
    const callerNode = ctx.getOrCreateNodeWithBudget(callerId, site.definition, site.context.relativePath, visitedNodes, budget);
    if (!callerNode) {
      truncated = true;
      truncatedReason = truncatedReason ?? "cap";
      continue;
    }
    if (!definitionCache.has(callerId)) {
      definitionCache.set(callerId, {
        definition: site.definition,
        absPath: site.context.absPath,
        relativePath: site.context.relativePath
      });
    }

    const added = ctx.addEdge(callerNode, node, {
      callType: site.call.callType,
      confidence: match.confidence,
      line: typeof site.call.line === "number" ? site.call.line : 0,
      column: typeof site.call.column === "number" ? site.call.column : 0
    }, budget);
    if (!added && budget?.exhausted) {
      truncated = true;
      truncatedReason = truncatedReason ?? "cap";
      break;
    }

    ctx.enqueueNode(callerId, nextDepth, maxDepth, queue, depthBySymbol, processed);
  }

  return { truncated, ...(truncatedReason ? { truncatedReason } : {}) };
};
