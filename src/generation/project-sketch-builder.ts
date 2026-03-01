import type { DependencyGraph } from "../ast/DependencyGraph.js";
import type { IndexStateManager } from "../indexing/IndexStateManager.js";
import type { Edge, ProjectSketch, TopModule } from "../types/flow-artifacts.js";

/** Inlined from deleted ImpactAnalysis — simple PageRank for module ranking. */
function computePageRankFromEdges(edges: Array<{ from: string; to: string }>, damping = 0.85, iterations = 20): Map<string, number> {
    const nodes = new Set<string>();
    const outgoing = new Map<string, string[]>();
    for (const { from, to } of edges) {
        nodes.add(from);
        nodes.add(to);
        const list = outgoing.get(from) ?? [];
        list.push(to);
        outgoing.set(from, list);
    }
    const n = nodes.size;
    if (n === 0) return new Map();
    const rank = new Map<string, number>();
    for (const node of nodes) rank.set(node, 1 / n);
    for (let i = 0; i < iterations; i++) {
        const next = new Map<string, number>();
        for (const node of nodes) next.set(node, (1 - damping) / n);
        for (const [from, targets] of outgoing) {
            const share = (rank.get(from) ?? 0) * damping / targets.length;
            for (const to of targets) next.set(to, (next.get(to) ?? 0) + share);
        }
        for (const [k, v] of next) rank.set(k, v);
    }
    return rank;
}

export interface ProjectSketchBuilderOptions {
    maxTopModules?: number;
    maxEdges?: number;
    includeAscii?: boolean;
    includeMermaid?: boolean;
    degradeThreshold?: number;
}

export class ProjectSketchBuilder {
    constructor(
        private readonly dependencyGraph: DependencyGraph,
        private readonly indexStateManager?: IndexStateManager,
        private readonly options: ProjectSketchBuilderOptions = {}
    ) {}

    public async build(): Promise<ProjectSketch> {
        const fileCount = await this.resolveFileCount();
        const degraded = fileCount > (this.options.degradeThreshold ?? 500);

        await this.dependencyGraph.ensureBuilt();
        const edges = this.dependencyGraph.listAllEdges();

        const topModules = await this.extractTopModules(edges, degraded);
        const edgesSample = this.sampleEdges(edges, topModules);
        const summary = this.generateSummary(topModules, edgesSample, fileCount, degraded);
        const ascii = this.options.includeAscii !== false
            ? this.renderAsciiTree(topModules, edgesSample)
            : undefined;
        const mermaid = this.options.includeMermaid !== false
            ? this.renderMermaid(topModules, edgesSample)
            : undefined;

        return {
            summary,
            topModules,
            edgesSample,
            ascii,
            mermaid,
            degraded,
            view: "full"
        };
    }

    private async resolveFileCount(): Promise<number> {
        if (this.indexStateManager) {
            await this.indexStateManager.getSnapshot().catch(() => undefined);
        }
        try {
            const status = await this.dependencyGraph.getIndexStatus();
            return status?.global?.indexedFiles ?? status?.global?.totalFiles ?? 0;
        } catch {
            return 0;
        }
    }

    private async extractTopModules(edges: Array<{ from: string; to: string }>, degraded: boolean): Promise<TopModule[]> {
        if (!edges.length) return [];
        const ranks = computePageRankFromEdges(edges);
        if (ranks.size === 0) return [];

        const incomingCounts = new Map<string, number>();
        for (const edge of edges) {
            const current = incomingCounts.get(edge.to) ?? 0;
            incomingCounts.set(edge.to, current + 1);
        }

        const maxTopModules = this.options.maxTopModules ?? 10;
        const sorted = Array.from(ranks.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, Math.max(1, maxTopModules));

        return sorted.map(([path, score]) => {
            const reasons = ["high pageRank"];
            const incoming = incomingCounts.get(path) ?? 0;
            if (incoming >= (degraded ? 20 : 10)) {
                reasons.push("many dependents");
            }
            if (degraded) {
                reasons.push("degraded sampling");
            }
            return {
                path,
                score: Number(score.toFixed(6)),
                why: reasons
            };
        });
    }

    private sampleEdges(edges: Array<{ from: string; to: string; type?: string }>, topModules: TopModule[]): Edge[] {
        if (!edges.length || topModules.length === 0) return [];
        const topSet = new Set(topModules.map((module) => module.path));
        const maxEdges = this.options.maxEdges ?? 20;
        const sampled: Edge[] = [];
        for (const edge of edges) {
            if (sampled.length >= maxEdges) break;
            if (!topSet.has(edge.from) || !topSet.has(edge.to)) continue;
            sampled.push({
                from: edge.from,
                to: edge.to,
                type: (edge.type as Edge["type"]) ?? "uses"
            });
        }
        return sampled;
    }

    private generateSummary(topModules: TopModule[], edges: Edge[], fileCount: number, degraded: boolean): string {
        const topNames = topModules.slice(0, 3).map((module) => module.path).join(", ");
        const topSummary = topNames ? `Top modules: ${topNames}.` : "No dominant modules detected.";
        const edgeSummary = edges.length > 0 ? `${edges.length} cross-module edges sampled.` : "No module edges sampled.";
        const fileSummary = fileCount > 0 ? `Files indexed: ${fileCount}.` : "File count unavailable.";
        const degradeSummary = degraded ? "Degraded mode enabled for large project." : "Full analysis mode.";
        return `${topSummary} ${edgeSummary} ${fileSummary} ${degradeSummary}`.trim();
    }

    private renderAsciiTree(topModules: TopModule[], edges: Edge[]): string {
        const lines: string[] = ["Project Sketch", "", "Top Modules:"];
        if (topModules.length === 0) {
            lines.push("- (none)");
        } else {
            for (const module of topModules) {
                lines.push(`- ${module.path} (score=${module.score})`);
            }
        }
        lines.push("", "Edges:");
        if (edges.length === 0) {
            lines.push("- (none)");
        } else {
            for (const edge of edges) {
                lines.push(`- ${edge.from} -> ${edge.to} [${edge.type}]`);
            }
        }
        return lines.join("\n");
    }

    private renderMermaid(topModules: TopModule[], edges: Edge[]): string {
        const lines: string[] = ["flowchart LR"];
        const idMap = new Map<string, string>();
        topModules.forEach((module, index) => {
            const id = `m${index}`;
            idMap.set(module.path, id);
            lines.push(`  ${id}["${module.path}"]`);
        });
        for (const edge of edges) {
            const fromId = idMap.get(edge.from);
            const toId = idMap.get(edge.to);
            if (!fromId || !toId) continue;
            lines.push(`  ${fromId} -->|${edge.type}| ${toId}`);
        }
        return lines.join("\n");
    }
}
