import type { DependencyGraph } from "../../ast/DependencyGraph.js";
import { computePageRankFromEdges } from "../pillars/change/ImpactAnalysis.js";
import type { IndexSnapshot } from "../../indexing/IndexStateManager.js";
import type { IntegrityGuardrailsConfig, SafetyChecklistItem } from "./IntegrityGuardrailsTypes.js";
import { normalizePath, toRelativePath } from "../../utils/PathHelpers.js";

let cachedPageRank: {
    timestamp: number;
    edgeCount: number;
    ranks: Map<string, number>;
} | null = null;

export const evaluateCoreProtection = async (args: {
    targetPath: string;
    dependencyGraph?: DependencyGraph;
    config: IntegrityGuardrailsConfig;
    indexSnapshot?: IndexSnapshot;
}): Promise<{
    isCore: boolean;
    details?: Record<string, unknown>;
    checklist?: SafetyChecklistItem[];
}> => {
    if (!args.dependencyGraph) {
        return { isCore: false };
    }
    try {
        await args.dependencyGraph.ensureBuilt();
        const ranks = await getPageRank(args.dependencyGraph, args.config.performance.pageRankCacheTTL);
        const targetRelative = normalizePath(toRelativePath(process.cwd(), args.targetPath));
        const pageRank = ranks.get(targetRelative) ?? ranks.get(normalizePath(args.targetPath)) ?? 0;
        const incoming = await args.dependencyGraph.getDependencies(args.targetPath, "upstream");
        const incomingCount = incoming.length;
        const isCoreByRank = pageRank >= args.config.coreProtection.pageRankThreshold;
        const isCoreByDeps = incomingCount >= args.config.coreProtection.incomingCountThreshold;
        const isCore = isCoreByRank || isCoreByDeps;
        if (!isCore) {
            return { isCore: false };
        }
        const checklist = buildSafetyChecklist(args.targetPath, pageRank, incomingCount);
        return {
            isCore,
            details: {
                file: targetRelative,
                pageRank: Number(pageRank.toFixed(4)),
                incomingDependencies: incomingCount,
                reason: isCoreByRank ? "high_pagerank" : "high_dependency_count",
                staleRisk: args.indexSnapshot?.staleRisk ?? "low"
            },
            checklist
        };
    } catch {
        return { isCore: false };
    }
};

const getPageRank = async (graph: DependencyGraph, ttlMs: number): Promise<Map<string, number>> => {
    const edges = graph.listAllEdges();
    const edgeCount = edges.length;
    const now = Date.now();
    if (cachedPageRank && cachedPageRank.edgeCount === edgeCount && now - cachedPageRank.timestamp < ttlMs) {
        return cachedPageRank.ranks;
    }
    const ranks = computePageRankFromEdges(edges);
    cachedPageRank = { timestamp: now, edgeCount, ranks };
    return ranks;
};

const buildSafetyChecklist = (filePath: string, pageRank: number, incoming: number): SafetyChecklistItem[] => {
    const relative = normalizePath(toRelativePath(process.cwd(), filePath));
    const items: SafetyChecklistItem[] = [
        {
            id: "impact_review",
            description: `Review all ${incoming} files that depend on ${relative}`,
            required: true
        },
        {
            id: "backward_compat",
            description: "Ensure backward compatibility or document breaking changes",
            required: true
        },
        {
            id: "test_coverage",
            description: "Add/update tests for modified functionality",
            required: true
        }
    ];
    if (pageRank >= 0.5) {
        items.push({
            id: "architecture_review",
            description: "Get architecture approval for top-tier core file changes",
            required: true
        });
    }
    if (incoming >= 50) {
        items.push({
            id: "gradual_rollout",
            description: "Consider feature flag or gradual rollout",
            required: false
        });
    }
    return items;
};
