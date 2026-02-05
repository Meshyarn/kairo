import path from "path";
import { LRUCache } from "lru-cache";
import { InternalToolRegistry } from "../../InternalToolRegistry.js";
import { OrchestrationContext } from "../../OrchestrationContext.js";
import { ParsedIntent } from "../../IntentRouter.js";
import type { QueryMetrics } from "../../../engine/search/QueryMetrics.js";
import { IntegrityEngine } from "../../../integrity/IntegrityEngine.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import { AstManager } from "../../../ast/AstManager.js";
import { ProjectSketchBuilder } from "../../../generation/project-sketch-builder.js";
import type { ResearchPack } from "../../../types/flow-artifacts.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import { applyTokenBudget } from "../../TokenBudget.js";
import { metrics } from "../../../utils/MetricsCollector.js";
import {
    DEFAULT_PACK_CACHE_SIZE,
    DEFAULT_PACK_TTL_MS,
    DEFAULT_RESEARCH_CACHE_SIZE,
    DEFAULT_RESEARCH_TTL_MS
} from "./ExplorePillarDefaults.js";
import { ExploreItem, ExploreResponse, truncate } from "./ResultFormatter.js";
import type { ExplorePack } from "./EvidencePackBuilder.js";
import { isDocPath } from "./FilteringStrategy.js";
import { createExploreExecutionState } from "./ExplorePillarExecutionState.js";
import { initializeExploreExecution } from "./ExplorePillarExecutionSetup.js";
import { executeExploreQuery } from "./ExplorePillarExecutionQuery.js";
import { executeExplorePaths } from "./ExplorePillarExecutionPaths.js";
import { executeExploreClusters } from "./ExplorePillarExecutionClusters.js";
import { finalizeExploreResponse } from "./ExplorePillarExecutionFinalize.js";
import { applyBudgetToExploreItem } from "./ExploreDecisionEngine.js";

export class ExplorePillar {
    private static packCache = new LRUCache<string, ExplorePack>({
        max: DEFAULT_PACK_CACHE_SIZE,
        ttl: DEFAULT_PACK_TTL_MS
    });
    private static researchCache = new LRUCache<string, ResearchPack>({
        max: DEFAULT_RESEARCH_CACHE_SIZE,
        ttl: DEFAULT_RESEARCH_TTL_MS
    });

    constructor(private readonly registry: InternalToolRegistry) {}

    public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<ExploreResponse> {
        const stopTotal = metrics.startTimer("explore.total_ms");
        const startedAt = Date.now();
        try {
        const setup = await initializeExploreExecution({
            intent,
            context,
            registry: this.registry,
            startedAt,
            runTool: (ctx, tool, args) => this.runTool(ctx, tool, args),
            isSymbolLikeQuery: (metrics, tokens) => this.isSymbolLikeQuery(metrics, tokens)
        });
        const { input } = setup;

        if (!input.query && input.paths.length === 0 && !input.researchRequested) {
            return {
                success: false,
                status: "invalid_args",
                message: "Missing query or paths.",
                data: { docs: [], code: [] },
                sessionId: input.resolvedSessionId
            };
        }

        const response: ExploreResponse = {
            success: true,
            status: "ok",
            query: input.query,
            data: { docs: [], code: [] },
            sessionId: input.resolvedSessionId
        };
        if (input.researchRequested) {
            if (setup.researchOmitted) {
                if (setup.traceBuilder) {
                    setup.traceBuilder.recordSkip("research_pack", "budget_exceeded", "allocator omitted research pack");
                }
            } else {
                response.researchPack = await this.buildResearchPack(input.research, input.resolvedSessionId, intent.originalIntent).catch(() => undefined);
            }
            if (!response.researchPack && !setup.researchOmitted) {
                response.insights = response.insights || [];
                response.insights.push({
                    type: "warning",
                    message: "Research pack generation failed. Ensure dependency graph indexing is available.",
                    relatedSymbols: []
                });
            }
        }

        if (!input.query && input.paths.length === 0) {
            this.addIndexStatusInsights(response);
            await this.attachIndexSnapshot(response);
            return response;
        }
        if (input.integrityOptions && input.integrityOptions.mode !== "off") {
            const integrityQuery = input.query ?? (input.paths.length > 0 ? path.basename(input.paths[0]) : undefined);
            const integrityResult = await IntegrityEngine.run(
                {
                    query: integrityQuery,
                    targetPaths: input.paths,
                    scope: input.integrityOptions.scope ?? "auto",
                    sources: input.integrityOptions.sources ?? [],
                    limits: input.integrityOptions.limits ?? {},
                    mode: input.integrityOptions.mode ?? "warn"
                },
                (tool, args) => this.runTool(context, tool, args)
            );
            response.integrity = integrityResult.report;
        }

        const state = createExploreExecutionState();
        const applyBudgetToItem = (item: ExploreItem, isFullContent: boolean, allowDistill: boolean): ExploreItem => {
            return applyBudgetToExploreItem(state.budgetState, item, {
                isFullContent,
                allowDistill,
                maxItemTokens: setup.maxItemTokens,
                maxChars: setup.maxChars,
                maxItemChars: setup.maxItemChars,
                getLanguageId: (filePath) => (filePath && !isDocPath(filePath) ? AstManager.getInstance().getLanguageId(filePath) : undefined),
                applyTokenBudget,
                truncate
            });
        };

        await executeExploreQuery({
            setup,
            state,
            response,
            registry: this.registry,
            context,
            packCache: ExplorePillar.packCache,
            runTool: (ctx, tool, args) => this.runTool(ctx, tool, args),
            expandDocContent: (item, maxChars, ctx, strategy, query) => this.expandDocContent(item, maxChars, ctx, strategy, query),
            expandCodeContent: (item, maxChars, ctx) => this.expandCodeContent(item, maxChars, ctx)
        });

        const pathResult = await executeExplorePaths({
            setup,
            state,
            response,
            registry: this.registry,
            context,
            runTool: (ctx, tool, args) => this.runTool(ctx, tool, args),
            applyBudgetToItem
        });
        if (pathResult) return pathResult;

        await executeExploreClusters({
            setup,
            state,
            response,
            registry: this.registry,
            context
        });

        finalizeExploreResponse({ setup, state, response });

        this.addIndexStatusInsights(response);
        await this.attachIndexSnapshot(response);

        setup.adaptiveLod?.recordOutcome({
            sessionId: input.resolvedSessionId,
            tool: "explore",
            success: Boolean(response.success),
            degradedReasons: response.degradedReasons
        });
        return response;
        } finally {
            stopTotal();
        }
    }

    private addIndexStatusInsights(response: ExploreResponse): void {
        try {
            const searchEngine = this.registry.getMetadata<any>('searchEngine');
            if (!searchEngine) return;

            const isReady = searchEngine.isIndexReady?.();
            const isBuilding = searchEngine.isIndexBuilding?.();

            if (isBuilding) {
                response.insights = response.insights || [];
                response.insights.push({
                    type: "info",
                    message: "Search index is building in the background. Results will improve as indexing completes.",
                    relatedSymbols: [],
                    suggestedAction: "Wait for indexing to complete, or use `manage` tool with command `reindex` to force a rebuild."
                });
            } else if (isReady === false) {
                response.insights = response.insights || [];
                response.insights.push({
                    type: "warning",
                    message: "Search index is not ready. Results may be incomplete.",
                    relatedSymbols: [],
                    suggestedAction: "Use `manage` tool with command `reindex` to build the search index for better results."
                });
            }
        } catch {
            // Optional guidance
        }
    }

    private async attachIndexSnapshot(response: ExploreResponse): Promise<void> {
        const indexState = this.registry.getMetadata<IndexStateManager>("indexStateManager");
        if (!indexState) return;
        try {
            response.indexSnapshot = await indexState.getSnapshot();
        } catch {
            // Optional metadata
        }
    }

    private async buildResearchPack(
        research?: {
        sketch?: boolean;
        topN?: number;
        format?: "ascii" | "mermaid" | "both";
        },
        sessionId?: string,
        intent?: string
    ): Promise<ResearchPack | undefined> {
        if (research?.sketch === false) {
            return undefined;
        }
        const dependencyGraph = this.registry.getMetadata<DependencyGraph>("dependencyGraph");
        if (!dependencyGraph) {
            return undefined;
        }
        const indexState = this.registry.getMetadata<IndexStateManager>("indexStateManager");
        const indexSnapshot = indexState
            ? await indexState.getSnapshot().catch(() => undefined)
            : undefined;
        const artifactManager = this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
        const cacheKey = this.getResearchCacheKey(research, indexSnapshot);
        if (cacheKey) {
            const cached = ExplorePillar.researchCache.get(cacheKey);
            if (cached) {
                if (sessionId && artifactManager) {
                    const derived = {
                        ...cached,
                        id: this.generateResearchPackId(),
                        createdAt: Date.now(),
                        expiresAt: Date.now() + DEFAULT_RESEARCH_TTL_MS
                    };
                    artifactManager.store({
                        id: derived.id,
                        type: "research",
                        createdAt: derived.createdAt,
                        expiresAt: derived.expiresAt,
                        pack: derived,
                        sessionId,
                        metadata: intent ? { intent } : undefined
                    });
                    return derived;
                }
                return cached;
            }
        }
        const format = research?.format ?? "both";
        const includeAscii = format === "both" || format === "ascii";
        const includeMermaid = format === "both" || format === "mermaid";
        const builder = new ProjectSketchBuilder(dependencyGraph, indexState, {
            maxTopModules: research?.topN,
            includeAscii,
            includeMermaid
        });
        const sketch = await builder.build();
        const now = Date.now();
        const pack: ResearchPack = {
            id: this.generateResearchPackId(),
            sketch,
            createdAt: now,
            expiresAt: now + DEFAULT_RESEARCH_TTL_MS
        };
        if (artifactManager) {
            artifactManager.store({
                id: pack.id,
                type: "research",
                createdAt: pack.createdAt,
                expiresAt: pack.expiresAt,
                pack,
                sessionId,
                metadata: intent ? { intent } : undefined
            });
        }
        if (cacheKey) {
            ExplorePillar.researchCache.set(cacheKey, pack);
        }
        return pack;
    }

    private getResearchCacheKey(
        research: { topN?: number; format?: "ascii" | "mermaid" | "both" } | undefined,
        snapshot?: { epoch?: number; dirtyFileCount?: number; staleRisk?: string }
    ): string | undefined {
        if (snapshot && snapshot.dirtyFileCount && snapshot.dirtyFileCount > 0) {
            return undefined;
        }
        const format = research?.format ?? "both";
        const topN = research?.topN ?? "default";
        const epoch = snapshot?.epoch ?? 0;
        return `research:${format}:${topN}:epoch:${epoch}`;
    }

    private generateResearchPackId(): string {
        const suffix = Math.random().toString(36).slice(2, 8);
        return `rp_${Date.now().toString(36)}_${suffix}`;
    }

    private async expandDocContent(
        item: ExploreItem,
        maxChars: number,
        context: OrchestrationContext,
        strategy: "raw" | "preview" | "summary" | "distill" | "truncate",
        query?: string
    ): Promise<ExploreItem> {
        const headingPath = Array.isArray(item.metadata?.headingPath) ? item.metadata?.headingPath : undefined;
        const mode = strategy === "summary" || strategy === "distill"
            ? "summary"
            : (strategy === "preview" || strategy === "truncate" ? "preview" : "raw");
        const result = await this.runTool(context, "document_section", {
            filePath: item.filePath,
            headingPath,
            includeSubsections: false,
            mode,
            maxChars,
            ...(query ? { query } : {})
        });
        return {
            ...item,
            content: typeof result?.content === "string" ? result.content : item.preview
        };
    }

    private async expandCodeContent(item: ExploreItem, maxChars: number, context: OrchestrationContext): Promise<ExploreItem> {
        const startLine = item.range?.startLine;
        const endLine = item.range?.endLine;
        const lineRange = startLine ? `${startLine}-${endLine ?? startLine}` : undefined;
        const result = await this.runTool(context, "code_read", {
            filePath: item.filePath,
            view: lineRange ? "fragment" : "skeleton",
            lineRange
        });
        const content = typeof result === "string" ? result : "";
        return {
            ...item,
            content: truncate(content, maxChars)
        };
    }

    private async runTool(context: OrchestrationContext, tool: string, args: any) {
        const started = Date.now();
        const output = await this.registry.execute(tool, args);
        context.addStep({
            id: `${tool}_${context.getFullHistory().length + 1}`,
            tool,
            args,
            output,
            status: output?.success === false || output?.isError ? "failure" : "success",
            duration: Date.now() - started
        });
        return output;
    }

    private isSymbolLikeQuery(metrics: QueryMetrics, tokens: string[]): boolean {
        if (metrics.hasSymbolHint) return true;
        if (tokens.length === 0) return false;
        if (!tokens.every(token => /^[A-Za-z_$][\w$]*$/.test(token))) return false;
        const hasSymbolToken = tokens.some(token => /[A-Z_]/.test(token) || /\d/.test(token));
        return tokens.length > 1 ? hasSymbolToken : hasSymbolToken;
    }
}
