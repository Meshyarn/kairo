import type { DependencyGraph } from "../../ast/DependencyGraph.js";
import type { ImportInfo } from "../../indexing/ProjectIndex.js";
import { normalizePath, toRelativePath } from "../../utils/PathHelpers.js";
import type { LayerRulesConfig } from "./IntegrityGuardrailsTypes.js";

export const evaluateCycleAndLayers = async (args: {
    targetPath: string;
    dependencyGraph?: DependencyGraph;
    newImports: ImportInfo[];
    oldImports: ImportInfo[];
    layerRules?: LayerRulesConfig;
}): Promise<{
    cycleDetected: boolean;
    cycleDetails: string[];
    layerViolations: Array<{ from: string; to: string; fromLayer: string | null; toLayer: string | null }>;
}> => {
    const cycleDetails: string[] = [];
    const layerViolations: Array<{ from: string; to: string; fromLayer: string | null; toLayer: string | null }> = [];
    let cycleDetected = false;

    const addedTargets = diffResolvedTargets(args.newImports, args.oldImports);
    const fromPath = normalizePath(toRelativePath(process.cwd(), args.targetPath));
    if (args.layerRules?.layers?.length && addedTargets.length > 0) {
        const fromLayer = resolveLayer(args.targetPath, args.layerRules);
        for (const target of addedTargets) {
            const toLayer = resolveLayer(target, args.layerRules);
            if (!isAllowedLayerDependency(fromLayer, toLayer, args.layerRules)) {
                layerViolations.push({
                    from: fromPath,
                    to: normalizePath(target),
                    fromLayer,
                    toLayer
                });
            }
        }
    }

    if (args.dependencyGraph && addedTargets.length > 0) {
        try {
            await args.dependencyGraph.ensureBuilt();
            const edges = args.dependencyGraph.listAllEdges();
            const adjacency = buildAdjacencyMap(edges);
            for (const target of addedTargets) {
                const toPath = normalizePath(target);
                addEdge(adjacency, fromPath, toPath);
            }
            const cycles = detectCycles(adjacency, [fromPath, ...addedTargets], 2);
            if (cycles.length > 0) {
                cycleDetected = true;
                cycleDetails.push(...cycles);
            }
        } catch {
            // ignore graph failures
        }
    }

    return { cycleDetected, cycleDetails, layerViolations };
};

export const matchGlob = (value: string, pattern: string): boolean => {
    const normalized = normalizePath(value);
    const normalizedPattern = normalizePath(pattern);
    const regex = globToRegex(normalizedPattern);
    return regex.test(normalized);
};

const diffResolvedTargets = (newImports: ImportInfo[], oldImports: ImportInfo[]): string[] => {
    const normalize = (value?: string) => (value ? normalizePath(toRelativePath(process.cwd(), value)) : "");
    const oldSet = new Set(oldImports.map(imp => normalize(imp.resolvedPath)).filter(Boolean));
    const added: string[] = [];
    for (const imp of newImports) {
        const resolved = imp.resolvedPath
            ? normalizePath(toRelativePath(process.cwd(), imp.resolvedPath))
            : "";
        if (!resolved || oldSet.has(resolved)) continue;
        added.push(resolved);
    }
    return added;
};

const buildAdjacencyMap = (edges: Array<{ from?: string; to?: string }>): Map<string, Set<string>> => {
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
        if (!edge.from || !edge.to) continue;
        const from = normalizePath(toRelativePath(process.cwd(), edge.from));
        const to = normalizePath(toRelativePath(process.cwd(), edge.to));
        if (!adjacency.has(from)) {
            adjacency.set(from, new Set());
        }
        adjacency.get(from)!.add(to);
    }
    return adjacency;
};

const addEdge = (adjacency: Map<string, Set<string>>, from: string, to: string): void => {
    if (!adjacency.has(from)) {
        adjacency.set(from, new Set());
    }
    adjacency.get(from)!.add(to);
};

const detectCycles = (
    adjacency: Map<string, Set<string>>,
    starts: string[],
    maxCycles: number
): string[] => {
    const startSet = new Set(starts.map(node => normalizePath(node)));
    const reachable = collectReachable(adjacency, startSet, 2000);
    const nodes = Array.from(reachable);
    if (nodes.length === 0) return [];

    const indexMap = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const cycles: string[] = [];
    let index = 0;

    const strongConnect = (node: string) => {
        indexMap.set(node, index);
        lowlink.set(node, index);
        index += 1;
        stack.push(node);
        onStack.add(node);

        const neighbors = adjacency.get(node) ?? new Set<string>();
        for (const next of neighbors) {
            if (!reachable.has(next)) continue;
            if (!indexMap.has(next)) {
                strongConnect(next);
                lowlink.set(node, Math.min(lowlink.get(node)!, lowlink.get(next)!));
            } else if (onStack.has(next)) {
                lowlink.set(node, Math.min(lowlink.get(node)!, indexMap.get(next)!));
            }
        }

        if (lowlink.get(node) === indexMap.get(node)) {
            const scc: string[] = [];
            let w: string | undefined;
            do {
                w = stack.pop();
                if (!w) break;
                onStack.delete(w);
                scc.push(w);
            } while (w !== node);

            if (scc.length > 1 && scc.some(entry => startSet.has(entry))) {
                cycles.push(scc.join(" -> "));
            }
        }
    };

    for (const node of nodes) {
        if (cycles.length >= maxCycles) break;
        if (!indexMap.has(node)) {
            strongConnect(node);
        }
    }

    return cycles.slice(0, maxCycles);
};

const collectReachable = (
    adjacency: Map<string, Set<string>>,
    starts: Set<string>,
    maxNodes: number
): Set<string> => {
    const queue = Array.from(starts);
    const reachable = new Set<string>();
    while (queue.length > 0 && reachable.size < maxNodes) {
        const node = queue.shift()!;
        if (reachable.has(node)) continue;
        reachable.add(node);
        const neighbors = adjacency.get(node);
        if (!neighbors) continue;
        for (const next of neighbors) {
            if (!reachable.has(next)) {
                queue.push(next);
            }
        }
    }
    return reachable;
};

const resolveLayer = (filePath: string, rules: LayerRulesConfig): string | null => {
    const normalized = normalizePath(toRelativePath(process.cwd(), filePath));
    for (const layer of rules.layers) {
        if (layer.match.some(pattern => matchGlob(normalized, pattern))) {
            return layer.name;
        }
    }
    return null;
};

const isAllowedLayerDependency = (fromLayer: string | null, toLayer: string | null, rules: LayerRulesConfig): boolean => {
    if (!fromLayer || !toLayer) return true;
    if (rules.deny?.some(rule => rule.from === fromLayer && rule.to === toLayer)) {
        return false;
    }
    if (rules.allow?.length) {
        return rules.allow.some(rule => rule.from === fromLayer && rule.to === toLayer);
    }
    return true;
};

const globToRegex = (pattern: string): RegExp => {
    const escaped = pattern
        .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`);
};
