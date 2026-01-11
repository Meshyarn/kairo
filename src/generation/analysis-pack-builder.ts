import type { AnalysisCluster, AnalysisPack } from "../types/flow-artifacts.js";

export interface AnalysisPackBuilderOptions {
    maxClusters?: number;
    maxFilesPerCluster?: number;
}

export interface AnalysisPackInput {
    goal: string;
    primaryFile?: string;
    searchResults?: Array<{ path?: string; score?: number; reason?: string }>;
    dependencyEdges?: Array<{ from: string; to: string; type?: string }>;
    hotSpots?: Array<{ path?: string; score?: number; reason?: string }>;
    degraded?: boolean;
}

export class AnalysisPackBuilder {
    constructor(private readonly options: AnalysisPackBuilderOptions = {}) {}

    public build(input: AnalysisPackInput): AnalysisPack {
        const maxClusters = Math.max(1, this.options.maxClusters ?? 3);
        const maxFiles = Math.max(1, this.options.maxFilesPerCluster ?? 15);
        const usedPaths = new Set<string>();
        const clusters: AnalysisCluster[] = [];

        const maybePushCluster = (cluster: AnalysisCluster | null) => {
            if (!cluster) return;
            if (clusters.length >= maxClusters) return;
            if (cluster.files.length === 0) return;
            clusters.push(cluster);
        };

        const primaryCluster = this.buildPrimaryCluster(input, usedPaths, maxFiles);
        maybePushCluster(primaryCluster);

        if (clusters.length < maxClusters) {
            const hotSpotCluster = this.buildHotSpotCluster(input, usedPaths, maxFiles);
            maybePushCluster(hotSpotCluster);
        }

        if (clusters.length < maxClusters) {
            const searchCluster = this.buildSearchCluster(input, usedPaths, maxFiles);
            maybePushCluster(searchCluster);
        }

        if (clusters.length === 0) {
            const fallback = this.buildFallbackCluster(input, usedPaths, maxFiles);
            maybePushCluster(fallback);
        }

        return {
            id: this.generatePackId(),
            goal: input.goal,
            clusters,
            createdAt: Date.now(),
            degraded: input.degraded
        };
    }

    private buildPrimaryCluster(
        input: AnalysisPackInput,
        usedPaths: Set<string>,
        maxFiles: number
    ): AnalysisCluster | null {
        const primary = input.primaryFile;
        const edges = input.dependencyEdges ?? [];
        const files: Array<{ path: string; score?: number; role?: string }> = [];
        const rationale: string[] = [];

        if (primary) {
            files.push({ path: primary, score: 1, role: "primary" });
            usedPaths.add(primary);
            rationale.push("Primary file resolved from goal.");
        }

        const outgoing = edges.filter((edge) => edge.from === primary).map((edge) => edge.to);
        const incoming = edges.filter((edge) => edge.to === primary).map((edge) => edge.from);

        for (const dep of outgoing) {
            if (files.length >= maxFiles) break;
            if (!dep || usedPaths.has(dep)) continue;
            files.push({ path: dep, score: 0.8, role: "dependency" });
            usedPaths.add(dep);
        }

        for (const parent of incoming) {
            if (files.length >= maxFiles) break;
            if (!parent || usedPaths.has(parent)) continue;
            files.push({ path: parent, score: 0.6, role: "incoming" });
            usedPaths.add(parent);
        }

        if (outgoing.length > 0) {
            rationale.push("Includes direct dependencies.");
        }
        if (incoming.length > 0) {
            rationale.push("Includes inbound references.");
        }

        if (files.length === 0) {
            return null;
        }

        return {
            id: this.generateClusterId("primary"),
            label: "Primary Focus",
            files,
            boundaries: {
                incoming: Array.from(new Set(incoming)),
                outgoing: Array.from(new Set(outgoing))
            },
            rationale
        };
    }

    private buildHotSpotCluster(
        input: AnalysisPackInput,
        usedPaths: Set<string>,
        maxFiles: number
    ): AnalysisCluster | null {
        const hotSpots = input.hotSpots ?? [];
        if (hotSpots.length === 0) return null;
        const files: Array<{ path: string; score?: number; role?: string }> = [];
        const rationale: string[] = ["Hotspot detection suggests elevated change risk."];

        for (const spot of hotSpots) {
            if (files.length >= maxFiles) break;
            const path = spot?.path;
            if (!path || usedPaths.has(path)) continue;
            files.push({ path, score: spot.score, role: "hotspot" });
            usedPaths.add(path);
            if (spot.reason) {
                rationale.push(spot.reason);
            }
        }

        if (files.length === 0) return null;

        return {
            id: this.generateClusterId("hotspots"),
            label: "Hot Spots",
            files,
            rationale
        };
    }

    private buildSearchCluster(
        input: AnalysisPackInput,
        usedPaths: Set<string>,
        maxFiles: number
    ): AnalysisCluster | null {
        const results = input.searchResults ?? [];
        if (results.length === 0) return null;
        const files: Array<{ path: string; score?: number; role?: string }> = [];
        const rationale: string[] = ["Search matches related to the goal."];

        for (const result of results) {
            if (files.length >= maxFiles) break;
            const path = result?.path;
            if (!path || usedPaths.has(path)) continue;
            files.push({ path, score: result.score, role: "related" });
            usedPaths.add(path);
            if (result.reason) {
                rationale.push(result.reason);
            }
        }

        if (files.length === 0) return null;

        return {
            id: this.generateClusterId("search"),
            label: "Related Matches",
            files,
            rationale
        };
    }

    private buildFallbackCluster(
        input: AnalysisPackInput,
        usedPaths: Set<string>,
        maxFiles: number
    ): AnalysisCluster | null {
        const files: Array<{ path: string; score?: number; role?: string }> = [];
        if (input.primaryFile && !usedPaths.has(input.primaryFile)) {
            files.push({ path: input.primaryFile, score: 1, role: "primary" });
            usedPaths.add(input.primaryFile);
        }
        for (const result of input.searchResults ?? []) {
            if (files.length >= maxFiles) break;
            const path = result?.path;
            if (!path || usedPaths.has(path)) continue;
            files.push({ path, score: result.score, role: "related" });
            usedPaths.add(path);
        }

        if (files.length === 0) return null;

        return {
            id: this.generateClusterId("fallback"),
            label: "Focus",
            files,
            rationale: ["Fallback cluster based on available signals."]
        };
    }

    private generatePackId(): string {
        const suffix = Math.random().toString(36).slice(2, 8);
        return `analysis_${Date.now().toString(36)}_${suffix}`;
    }

    private generateClusterId(prefix: string): string {
        const suffix = Math.random().toString(36).slice(2, 6);
        return `${prefix}_${suffix}`;
    }
}
