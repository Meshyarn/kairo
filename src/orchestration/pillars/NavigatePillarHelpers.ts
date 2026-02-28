import type { RepoRegistry } from "../../config/RepoRegistry.js";
import type { PathNormalizer } from "../../utils/PathNormalizer.js";
import { resolveRepoInfo } from "../../utils/RepoScope.js";
import type { InternalToolRegistry } from "../InternalToolRegistry.js";
import { GraphRagClusterService } from "../cluster/GraphRagClusterService.js";
import type { ProgressState } from "../../utils/ProgressLogger.js";

type ToolRunner = (tool: string, args: any, progress?: ProgressState) => Promise<any>;

export const truncateText = (text: string, maxChars: number): string => {
    const limit = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 1200;
    const value = String(text ?? "");
    if (value.length <= limit) return value;
    return `${value.slice(0, Math.max(1, limit - 1))}…`;
};

export const resolveSafeRepoInfo = (
    filePath: string,
    repoRegistry?: RepoRegistry,
    pathNormalizer?: PathNormalizer
): { repoId?: string; repoRelativePath?: string } => {
    if (!filePath || !repoRegistry || !pathNormalizer) return {};
    try {
        const info = resolveRepoInfo(filePath, repoRegistry, pathNormalizer);
        return {
            repoId: info.repoId,
            repoRelativePath: info.repoRelativePath
        };
    } catch {
        return {};
    }
};

export const attachGraphRagClusters = async (args: {
    registry: InternalToolRegistry;
    response: any;
    query: string;
    includeClusters: boolean;
    clusterOptions?: { maxClusters?: number; expansionDepth?: number; includePreview?: boolean };
    projectFileCount?: number;
    docHint?: boolean;
}): Promise<string[]> => {
    if (!args.includeClusters || !args.query) {
        return [];
    }
    const graphRagService = args.registry.getMetadata<GraphRagClusterService>("graphRagClusterService")
        ?? GraphRagClusterService.fromRegistry(args.registry);
    if (!args.registry.getMetadata("graphRagClusterService")) {
        args.registry.setMetadata("graphRagClusterService", graphRagService);
    }
    const result = await graphRagService.buildClusters({
        query: args.query,
        clusterOptions: args.clusterOptions,
        projectFileCount: args.projectFileCount,
        docHint: args.docHint
    });
    if (!result) {
        return [];
    }
    args.response.clusters = result.clusters;
    args.response.clusterPolicy = result.policy;
    return result.degradedReasons ?? [];
};

export const loadHotSpotSet = async (
    runTool: ToolRunner,
    results: any[],
    progress?: ProgressState
): Promise<Set<string>> => {
    if (results.length === 0) return new Set();
    if (results.length > 10) return new Set();
    let hotSpots: any = [];
    try {
        hotSpots = await runTool("hotspot_detect", {}, progress);
    } catch {
        return new Set();
    }
    const set = new Set<string>();
    if (Array.isArray(hotSpots)) {
        for (const spot of hotSpots) {
            if (spot?.filePath) set.add(spot.filePath);
        }
    }
    return set;
};

export const loadPageRankScores = async (
    runTool: ToolRunner,
    results: any[],
    progress?: ProgressState
): Promise<Map<string, number>> => {
    if (results.length !== 1) return new Map();
    const targetPath = results[0]?.path;
    if (!targetPath) return new Map();
    try {
        const deps = await runTool("relationship_analyze", {
            target: targetPath,
            mode: "dependencies",
            direction: "both"
        }, progress);
        const edges = Array.isArray(deps?.edges) ? deps.edges : [];
        return computePageRankFromEdges(edges);
    } catch {
        return new Map();
    }
};

export const loadRelatedSymbols = async (
    runTool: ToolRunner,
    target: string,
    progress?: ProgressState
): Promise<string[]> => {
    if (!target) return [];
    try {
        const matches = await runTool("project_search", {
            query: target,
            type: "symbol",
            maxResults: 5
        }, progress);
        const results = matches?.results ?? [];
        return results
            .filter((item: any) => isDefinitionSymbol(item))
            .map((item: any) => item?.symbol?.name ?? item?.context ?? item?.path ?? "")
            .filter(Boolean);
    } catch {
        return [];
    }
};

export const applyContextFilter = async (
    runTool: ToolRunner,
    target: string,
    contextMode: string,
    results: any[],
    limit: number,
    progress?: ProgressState
): Promise<any[]> => {
    if (contextMode === "all") return results;

    if (contextMode === "definitions") {
        const filtered = results.filter(item => isDefinitionSymbol(item));
        return filtered.length > 0 ? filtered : results;
    }

    if (contextMode === "usages") {
        const symbolMatch = await runTool("project_search", {
            query: target,
            type: "symbol",
            maxResults: 1
        }, progress);
        const symbolResult = symbolMatch?.results?.find((item: any) => isDefinitionSymbol(item)) ?? symbolMatch?.results?.[0];
        const symbolName = symbolResult?.symbol?.name ?? target;
        const definitionPath = symbolResult?.path;
        if (definitionPath) {
            const references = await runTool("reference_find", {
                symbolName,
                definitionPath
            }, progress);
            const refs = references?.references ?? [];
            if (Array.isArray(refs) && refs.length > 0) {
                return refs.slice(0, limit).map((ref: any) => ({
                    type: "usage",
                    path: ref.filePath ?? "",
                    score: 1,
                    context: ref.snippet ?? ref.text,
                    line: ref.line
                }));
            }
        }
        return results;
    }

    if (contextMode === "tests") {
        const filtered = results.filter((item: any) => isTestPath(item?.path ?? ""));
        if (filtered.length > 0) return filtered;
        const fallback = await runTool("project_search", {
            query: target,
            maxResults: limit,
            includeGlobs: ["**/*.test.*", "**/__tests__/**", "**/tests/**"]
        });
        return fallback?.results ?? [];
    }

    if (contextMode === "docs") {
        const filtered = results.filter((item: any) => isDocPath(item?.path ?? ""));
        if (filtered.length > 0) return filtered;
        const fallback = await runTool("project_search", {
            query: target,
            maxResults: limit,
            includeGlobs: ["**/*.md", "**/*.mdx", "**/docs/**"]
        });
        return fallback?.results ?? [];
    }

    return results;
};

export const resolveDocPath = async (
    runTool: ToolRunner,
    target: string,
    progress?: ProgressState
): Promise<string | null> => {
    if (!target) return null;
    const cleaned = target.replace(/^["'`]+|["'`]+$/g, "");
    if (isDocPath(cleaned)) {
        return cleaned;
    }
    if (!/[\\/]/.test(cleaned)) {
        const match = await runTool("project_search", {
            query: cleaned,
            type: "filename",
            maxResults: 1,
            includeGlobs: ["**/*.md", "**/*.mdx", "**/docs/**"]
        }, progress);
        return match?.results?.[0]?.path ?? null;
    }
    return cleaned;
};

export const isTestPath = (filePath: string): boolean => {
    return /\/tests?\//i.test(filePath) || /\.test\./i.test(filePath);
};

export const isDocPath = (filePath: string): boolean => {
    return /\.(md|mdx)$/i.test(filePath) || /\/docs\//i.test(filePath);
};

export const isDefinitionSymbol = (item: any): boolean => {
    const type = item?.symbol?.type;
    if (!type) return true;
    return type !== "import" && type !== "export";
};

export const extractLine = (item: any): number => {
    if (typeof item?.line === "number") return item.line;
    const symbolLine = item?.symbol?.range?.startLine;
    if (typeof symbolLine === "number") return symbolLine;
    return 0;
};

export const computePageRankFromEdges = (edges: Array<{ source?: string; target?: string; from?: string; to?: string }>): Map<string, number> => {
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
};
