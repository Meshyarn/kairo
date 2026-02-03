import path from "path";
import { InternalToolRegistry } from "../InternalToolRegistry.js";
import { analyzeQuery } from "../../engine/search/QueryMetrics.js";
import type { ClusterSearchOptions, ClusterSearchEngine } from "../../engine/ClusterSearch/index.js";
import type { SymbolEmbeddingIndex, SymbolSearchResult } from "../../indexing/SymbolEmbeddingIndex.js";
import type { SymbolIndex } from "../../ast/SymbolIndex.js";
import type { PathNormalizer } from "../../utils/PathNormalizer.js";
import type { RepoRegistry } from "../../config/RepoRegistry.js";
import { normalizeRepoScope, type NormalizedRepoScope, type RepoScope } from "../../utils/RepoScope.js";
import type { SymbolInfo } from "../../types.js";
import {
    ClusterSeed,
    ClusterSearchResponse,
    ClusterSummary,
    ClusterSummaryRelationshipState,
    ClusterSeedSource,
    ExpansionState,
    RelatedSymbolsContainer,
} from "../../types/cluster.js";
import {
    DEFAULT_GRAPHRAG_CONFIG,
    GraphRagConfigLoader,
    GraphRagSeedPolicyName,
    resolveGraphRagEnabled
} from "../../config/GraphRagConfig.js";
import { metrics } from "../../utils/MetricsCollector.js";
import { applyCrossBoundaryPolicy, getBoundaryEvidence } from "./GraphRagBoundaryPolicy.js";

export type GraphRagClusterOptions = {
    maxClusters?: number;
    expansionDepth?: number;
    includePreview?: boolean;
};

export type GraphRagClusterRequest = {
    query: string;
    clusterOptions?: GraphRagClusterOptions;
    projectFileCount?: number;
    docHint?: boolean;
    repoScope?: RepoScope;
    repoId?: string;
    repoIds?: string[];
    allowCrossRepoEdits?: boolean;
};

export type GraphRagClusterResult = {
    clusters: ClusterSummary[];
    policy: GraphRagSeedPolicyName;
    degradedReasons?: string[];
};

export class GraphRagClusterService {
    constructor(private readonly registry: InternalToolRegistry) {}

    public async buildClusters(args: GraphRagClusterRequest): Promise<GraphRagClusterResult | null> {
        const stopTimer = metrics.startTimer("graphrag.build_clusters_ms", "detailed");
        metrics.inc("graphrag.request_total");
        try {
        const query = String(args.query ?? "").trim();
        if (!query) {
            return null;
        }

        const config = this.resolveConfig();
        const enabled = resolveGraphRagEnabled(config);
        if (!enabled) {
            return {
                clusters: [],
                policy: config.seedPolicy.default,
                degradedReasons: ["graphrag_disabled"]
            };
        }

        const clusterSearchEngine = this.registry.getMetadata<ClusterSearchEngine>("clusterSearchEngine");
        if (!clusterSearchEngine) {
            return {
                clusters: [],
                policy: config.seedPolicy.default,
                degradedReasons: ["graphrag_disabled"]
            };
        }

        const clusterOptions: ClusterSearchOptions = {
            maxClusters: args.clusterOptions?.maxClusters,
            expansionDepth: args.clusterOptions?.expansionDepth,
            includePreview: args.clusterOptions?.includePreview
        };

        const symbolEmbeddingIndex = this.registry.getMetadata<SymbolEmbeddingIndex>("symbolEmbeddingIndex");
        const symbolIndex = this.registry.getMetadata<SymbolIndex>("symbolIndex");
        const pathNormalizer = this.registry.getMetadata<PathNormalizer>("pathNormalizer");
        const queryMetrics = analyzeQuery(query);
        const semanticEligible = this.isSemanticEligible(symbolEmbeddingIndex);
        const repoScope = this.resolveRepoScope(args);

        const selectedPolicy = this.selectPolicy(queryMetrics, config, {
            docHint: args.docHint,
            semanticEligible
        });
        metrics.inc(`graphrag.policy.selected.${selectedPolicy}`);

        const degradedReasons: string[] = [];
        let policyUsed: GraphRagSeedPolicyName = selectedPolicy;
        let response: ClusterSearchResponse | null = null;

        if (selectedPolicy === "symbol_semantic") {
            const semantic = await this.buildSemanticSeeds(query, symbolEmbeddingIndex, clusterOptions, degradedReasons);
            if (semantic.seeds.length > 0) {
                response = await clusterSearchEngine.searchWithSeeds(semantic.seeds, clusterOptions);
            } else {
                degradedReasons.push("graphrag_policy_degraded");
                policyUsed = "lexical_default";
            }
        } else if (selectedPolicy === "path_first") {
            const pathSeeds = await this.buildPathSeeds(query, symbolIndex, pathNormalizer, clusterOptions, degradedReasons);
            if (pathSeeds.length > 0) {
                response = await clusterSearchEngine.searchWithSeeds(pathSeeds, clusterOptions);
            } else {
                degradedReasons.push("graphrag_policy_degraded");
                policyUsed = "lexical_default";
            }
        } else if (selectedPolicy === "doc_first") {
            degradedReasons.push("graphrag_policy_degraded");
            policyUsed = "lexical_default";
        }

        if (!response) {
            response = await clusterSearchEngine.search(query, clusterOptions);
        }
        if (policyUsed !== selectedPolicy) {
            metrics.inc("graphrag.policy.fallback_total");
        }
        metrics.inc(`graphrag.policy.used.${policyUsed}`);

        const boundaryEvidence = await getBoundaryEvidence(this.registry);
        const crossBoundaryByCluster = new Map<string, ClusterSummary["crossBoundary"]>();
        for (const cluster of response.clusters) {
            const crossBoundary = applyCrossBoundaryPolicy({
                cluster,
                config,
                projectFileCount: args.projectFileCount,
                degradedReasons,
                boundaryEvidence,
                policy: {
                    repoScope,
                    allowCrossRepoEdits: args.allowCrossRepoEdits
                },
                registry: this.registry
            });
            if (crossBoundary) {
                crossBoundaryByCluster.set(cluster.clusterId, crossBoundary);
            }
        }
        const defaultSeedSource = this.resolveSeedSource(policyUsed);
        const clusters = this.summarizeClusters(response, defaultSeedSource, crossBoundaryByCluster);
        metrics.observe("graphrag.cluster_count", clusters.length, "detailed");
        if (degradedReasons.length > 0) {
            metrics.inc("graphrag.degraded_total");
            for (const reason of new Set(degradedReasons)) {
                metrics.inc(`graphrag.degraded.${reason}`);
            }
        }
        return {
            clusters,
            policy: policyUsed,
            degradedReasons: degradedReasons.length > 0 ? Array.from(new Set(degradedReasons)) : undefined
        };
        } finally {
            stopTimer();
        }
    }

    private resolveConfig() {
        const loader = this.registry.getMetadata<GraphRagConfigLoader>("graphRagConfig");
        return loader?.getConfig() ?? DEFAULT_GRAPHRAG_CONFIG;
    }

    private selectPolicy(
        metrics: ReturnType<typeof analyzeQuery>,
        config: ReturnType<GraphRagClusterService["resolveConfig"]>,
        signals: { docHint?: boolean; semanticEligible: boolean }
    ): GraphRagSeedPolicyName {
        let policy = config.seedPolicy.default;
        if (metrics.hasPath) {
            policy = "path_first";
        } else if (signals.semanticEligible && metrics.hasSymbolHint) {
            policy = "symbol_semantic";
        } else if (signals.docHint) {
            policy = "doc_first";
        }
        if (!(policy in config.seedPolicy.policies)) {
            policy = config.seedPolicy.default;
        }
        if (!(policy in config.seedPolicy.policies)) {
            policy = "lexical_default";
        }
        return policy;
    }

    private isSemanticEligible(symbolEmbeddingIndex?: SymbolEmbeddingIndex): boolean {
        const semanticEnabled = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_ENABLED ?? "false").toLowerCase() === "true";
        const semanticMode = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_MODE ?? "manual").toLowerCase();
        if (!semanticEnabled || semanticMode === "off") {
            return false;
        }
        if (!symbolEmbeddingIndex) {
            return false;
        }
        const status = symbolEmbeddingIndex.getStatus();
        return Boolean(status.enabled);
    }

    private async buildSemanticSeeds(
        query: string,
        symbolEmbeddingIndex: SymbolEmbeddingIndex | undefined,
        options: GraphRagClusterOptions,
        degradedReasons: string[]
    ): Promise<{ seeds: ClusterSeed[] }> {
        const seedLimit = this.resolveSeedLimit(options);
        const semanticEnabled = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_ENABLED ?? "false").toLowerCase() === "true";
        const semanticMode = (process.env.KAIRO_SYMBOL_SEMANTIC_SEARCH_MODE ?? "manual").toLowerCase();
        if (!semanticEnabled || semanticMode === "off") {
            degradedReasons.push("symbol_semantic_search_disabled");
            return { seeds: [] };
        }
        if (!symbolEmbeddingIndex) {
            degradedReasons.push("embedding_provider_disabled");
            return { seeds: [] };
        }
        const status = symbolEmbeddingIndex.getStatus();
        if (!status.lastBuildAt) {
            degradedReasons.push("symbol_embeddings_not_built");
            return { seeds: [] };
        }
        const semantic = await symbolEmbeddingIndex.searchSymbolsWithDiagnostics(query, { topK: seedLimit });
        if (semantic.degraded) {
            if (semantic.reason) degradedReasons.push(semantic.reason);
            return { seeds: [] };
        }
        if (semantic.results.length === 0) {
            degradedReasons.push("symbol_search_fallback_name");
            return { seeds: [] };
        }

        return {
            seeds: semantic.results.map((result) => this.toSemanticSeed(result))
        };
    }

    private async buildPathSeeds(
        query: string,
        symbolIndex: SymbolIndex | undefined,
        pathNormalizer: PathNormalizer | undefined,
        options: GraphRagClusterOptions,
        degradedReasons: string[]
    ): Promise<ClusterSeed[]> {
        if (!symbolIndex) {
            degradedReasons.push("symbol_index_unavailable");
            return [];
        }
        const candidate = this.extractPathCandidate(query);
        if (!candidate) {
            return [];
        }
        let normalized = candidate;
        try {
            if (pathNormalizer) {
                normalized = pathNormalizer.normalize(candidate);
            }
        } catch {
            degradedReasons.push("graphrag_policy_degraded");
            return [];
        }
        const absPath = pathNormalizer
            ? pathNormalizer.toAbsolute(normalized)
            : (path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate));
        const symbols = await symbolIndex.getSymbolsForFile(absPath);
        const definitions = symbols.filter(symbol => symbol.type !== "import" && symbol.type !== "export");
        if (definitions.length === 0) {
            return [];
        }
        const seedLimit = this.resolveSeedLimit(options);
        return definitions.slice(0, seedLimit).map((symbol, index) => ({
            filePath: normalized,
            symbol,
            matchType: "exact",
            matchScore: Math.max(0.5, 0.9 - index * 0.05),
            source: "path"
        }));
    }

    private resolveSeedLimit(options: GraphRagClusterOptions): number {
        const maxClusters = options.maxClusters ?? 5;
        return Math.max(maxClusters * 2, maxClusters);
    }

    private toSemanticSeed(result: SymbolSearchResult): ClusterSeed {
        const symbol = result.symbol;
        const normalizedType = symbol.type === "type" ? "type_alias" : symbol.type;
        const symbolInfo: SymbolInfo = {
            name: symbol.name,
            type: normalizedType,
            range: {
                startLine: symbol.lineRange?.start ?? 0,
                endLine: symbol.lineRange?.end ?? symbol.lineRange?.start ?? 0,
                startByte: symbol.range?.startByte ?? 0,
                endByte: symbol.range?.endByte ?? 0
            },
            signature: symbol.signature,
            content: symbol.content
        };
        return {
            filePath: symbol.filePath,
            symbol: symbolInfo,
            matchType: "fuzzy",
            matchScore: result.relevanceScore,
            source: "semantic"
        };
    }

    private summarizeClusters(
        response: ClusterSearchResponse,
        defaultSeedSource: ClusterSeedSource,
        crossBoundaryByCluster: Map<string, ClusterSummary["crossBoundary"]>
    ): ClusterSummary[] {
        const hints = response.expansionHints?.recommendedExpansions ?? [];
        const hintsByCluster = new Map<string, string[]>();
        for (const hint of hints) {
            const [clusterId] = hint.split(":");
            if (!clusterId) continue;
            const list = hintsByCluster.get(clusterId) ?? [];
            list.push(hint);
            hintsByCluster.set(clusterId, list);
        }

        return response.clusters.map((cluster) => {
            const seed = cluster.seeds[0];
            const seedSource = seed?.source ?? defaultSeedSource;
            return {
                clusterId: cluster.clusterId,
                entryPoint: {
                    filePath: cluster.metadata.entryPoint ?? seed?.filePath ?? "",
                    symbolName: seed?.symbol?.name
                },
                relevanceScore: cluster.metadata.relevanceScore,
                tokenEstimate: cluster.metadata.tokenEstimate,
                seed: {
                    source: seedSource,
                    filePath: seed?.filePath ?? "",
                    symbolName: seed?.symbol?.name,
                    matchType: seed?.matchType,
                    matchScore: seed?.matchScore
                },
                relationships: {
                    callers: this.summarizeRelationship(cluster.related.callers),
                    callees: this.summarizeRelationship(cluster.related.callees),
                    typeFamily: this.summarizeRelationship(cluster.related.typeFamily),
                    dependency: this.summarizeRelationship(cluster.related.dependency),
                    colocated: this.summarizeRelationship(cluster.related.colocated),
                    siblings: this.summarizeRelationship(cluster.related.siblings)
                },
                expansionHints: hintsByCluster.get(cluster.clusterId),
                crossBoundary: crossBoundaryByCluster.get(cluster.clusterId)
            };
        });
    }

    private summarizeRelationship(container: RelatedSymbolsContainer | undefined): { count: number; state: ClusterSummaryRelationshipState } | undefined {
        if (!container) return undefined;
        return {
            count: container.totalCount ?? container.data.length,
            state: this.mapRelationshipState(container.state)
        };
    }

    private mapRelationshipState(state: ExpansionState): ClusterSummaryRelationshipState {
        switch (state) {
            case ExpansionState.LOADED:
                return "loaded";
            case ExpansionState.TRUNCATED:
                return "truncated";
            case ExpansionState.FAILED:
                return "failed";
            case ExpansionState.LOADING:
            case ExpansionState.NOT_LOADED:
            default:
                return "not_loaded";
        }
    }

    private resolveSeedSource(policy: GraphRagSeedPolicyName): ClusterSeedSource {
        if (policy === "symbol_semantic") return "semantic";
        if (policy === "path_first") return "path";
        if (policy === "doc_first") return "doc";
        return "lexical";
    }

    private extractPathCandidate(text: string): string | null {
        if (!text) return null;
        const tokens = text.split(/\s+/).map(token =>
            token.replace(/^[\"'`(]+/, "").replace(/[\"'`),.;]+$/, "")
        );
        for (const token of tokens) {
            if (!token) continue;
            if (/[\\/]/.test(token) && /\.[a-z0-9]+$/i.test(token)) {
                return token;
            }
        }
        const trimmed = text.trim();
        if (/[\\/]/.test(trimmed) && /\.[a-z0-9]+$/i.test(trimmed)) {
            return trimmed;
        }
        return null;
    }

    private resolveRepoScope(args: GraphRagClusterRequest): NormalizedRepoScope | null {
        const repoRegistry = this.registry.getMetadata<RepoRegistry>("repoRegistry");
        if (!repoRegistry) return null;
        try {
            return normalizeRepoScope(args, repoRegistry, { defaultMode: "all" });
        } catch {
            return null;
        }
    }
}
