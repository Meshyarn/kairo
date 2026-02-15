import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { InternalToolRegistry } from "../../InternalToolRegistry.js";
import type { IFileSystem } from "../../../platform/FileSystem.js";
import type { UnifiedContextGraph } from "../../context/UnifiedContextGraph.js";
import type { LRUCache } from "lru-cache";
import { AstManager } from "../../../ast/AstManager.js";
import { applyTokenBudget, estimateTokens } from "../../TokenBudget.js";
import {
    applyBudgetToExploreItemsWithGlobalLimit,
    applyBudgetToExploreItem
} from "./ExploreDecisionEngine.js";
import { truncate, type ExploreItem, type ExploreResponse } from "./ResultFormatter.js";
import {
    type ExplorePack,
    parseItemsCursor,
    slicePack,
    computeNextCursor
} from "./EvidencePackBuilder.js";
import { isDocPath, isLogPath } from "./FilteringStrategy.js";
import { collectTopologyMetadata } from "./PathExpansion.js";
import { resolveAdaptiveFlowLOD } from "../../adaptive-flow/AdaptiveFlowGate.js";
import { DEFAULT_PACK_RESULTS, DEFAULT_PACK_TTL_MS } from "./ExplorePillarDefaults.js";
import type { ExploreExecutionSetup } from "./ExplorePillarExecutionSetup.js";
import type { ExploreExecutionState } from "./ExplorePillarExecutionState.js";

export async function executeExploreQuery(args: {
    setup: ExploreExecutionSetup;
    state: ExploreExecutionState;
    response: ExploreResponse;
    registry: InternalToolRegistry;
    context: OrchestrationContext;
    packCache: LRUCache<string, ExplorePack>;
    runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>;
    expandDocContent: (
        item: ExploreItem,
        maxChars: number,
        context: OrchestrationContext,
        strategy: "raw" | "preview" | "summary" | "distill" | "truncate",
        query?: string
    ) => Promise<ExploreItem>;
    expandCodeContent: (item: ExploreItem, maxChars: number, context: OrchestrationContext) => Promise<ExploreItem>;
}): Promise<void> {
    const { setup, state, response, registry, context, packCache, runTool, expandDocContent, expandCodeContent } = args;
    const { input } = setup;
    const query = input.query;
    if (!query) return;

    const applyBudgetToItem = (item: ExploreItem, isFullContent: boolean, allowDistill: boolean): ExploreItem => {
        return applyBudgetToExploreItem(state.budgetState, item, {
            isFullContent,
            allowDistill,
            maxItemTokens: setup.maxItemTokens,
            maxChars: setup.maxChars,
            maxItemChars: setup.maxItemChars,
            getLanguageId: (filePath) => isDocPath(filePath) ? undefined : AstManager.getInstance().getLanguageId(filePath),
            applyTokenBudget,
            truncate
        });
    };

    const cursorState = parseItemsCursor(input.constraints.cursor?.items);
    const contentCursorState = parseItemsCursor(input.constraints.cursor?.content);
    const cachedPack = setup.effectivePackId ? packCache.get(setup.effectivePackId) : undefined;

    if (cachedPack) {
        if (setup.traceBuilder) {
            setup.traceBuilder.setCache({ used: true, hit: true, keyHint: "explore.pack:v1" });
            setup.traceBuilder.recordSkip("doc_search", "cache_hit", "explore pack cache hit");
        }
        if (input.constraints.cursor?.content) {
            const sliced = slicePack(cachedPack, contentCursorState, setup.maxResults, setup.includeDocs, setup.includeCode, setup.includeComments, setup.includeLogs);
            const expandedDocs = setup.allowDocSectionExpand
                ? await Promise.all(sliced.docs.map((item) => expandDocContent(item, setup.docSectionMaxChars, context, setup.docSectionStrategy, query)))
                : sliced.docs;
            const expandedCode = await Promise.all(sliced.code.map((item) => expandCodeContent(item, setup.maxChars, context)));

            const applyBudgetWithGlobalLimit = (items: ExploreItem[]) => {
                const result = applyBudgetToExploreItemsWithGlobalLimit({
                    state: state.budgetState,
                    items,
                    isFullContent: true,
                    allowDistill: setup.view !== "full",
                    maxItemTokens: setup.maxItemTokens,
                    maxChars: setup.maxChars,
                    maxItemChars: setup.maxItemChars,
                    maxTokens: setup.maxTokens,
                    totalTokens: state.totalTokens,
                    degraded: state.degraded,
                    reasons: state.reasons,
                    getLanguageId: (filePath) => isDocPath(filePath) ? undefined : AstManager.getInstance().getLanguageId(filePath),
                    estimateTokens
                });
                state.totalTokens = result.totalTokens;
                state.degraded = result.degraded;
                return result.items;
            };

            response.data.docs = applyBudgetWithGlobalLimit(expandedDocs);
            response.data.code = applyBudgetWithGlobalLimit(expandedCode);
            if (sliced.nextCursor) {
                response.next = { contentCursor: sliced.nextCursor };
            }
        } else {
            const sliced = slicePack(cachedPack, cursorState, setup.maxResults, setup.includeDocs, setup.includeCode, setup.includeComments, setup.includeLogs);
            response.data.docs = sliced.docs.map((item) => applyBudgetToItem(item, false, false));
            response.data.code = sliced.code.map((item) => applyBudgetToItem(item, false, false));
            if (sliced.nextCursor) {
                response.next = { itemsCursor: sliced.nextCursor };
            }
        }
        response.pack = {
            packId: cachedPack.packId,
            hit: true,
            createdAt: cachedPack.createdAt,
            expiresAt: cachedPack.expiresAt
        };
        return;
    }

    if (setup.traceBuilder) {
        setup.traceBuilder.setCache({ used: true, hit: false, keyHint: "explore.pack:v1" });
    }
    const isDeepProfile = setup.profile === "deep";
    const packMaxResults = Math.max(setup.maxResults, DEFAULT_PACK_RESULTS, isDeepProfile ? 40 : 0);
    let docsForPack: ExploreItem[] = [];
    let codeForPack: ExploreItem[] = [];

    const ucg = context.getState<UnifiedContextGraph>("ucg");

    if (setup.includeCode) {
        const canRunCodeSearch = !setup.hasDeadline || setup.timeRemaining() > 250;
        if (!canRunCodeSearch) {
            state.degraded = true;
            if (!state.reasons.includes("budget_exceeded")) {
                state.reasons.push("budget_exceeded");
            }
            if (setup.traceBuilder) {
                setup.traceBuilder.recordSkip("code_search", "budget_exceeded", "timeout guard");
            }
        }
        let codeResults: any;
        if (canRunCodeSearch) {
            const codeSearchTimeoutMs = setup.hasDeadline
                ? Math.max(250, Math.min(1500, Math.floor(setup.timeRemaining() * 0.55)))
                : undefined;
            try {
                codeResults = await runTool(context, "project_search", {
                    query,
                    maxResults: packMaxResults,
                    type: "file",
                    repoScope: (input.constraints as any).repoScope,
                    repoId: (input.constraints as any).repoId,
                    repoIds: (input.constraints as any).repoIds,
                    budget: setup.searchBudget,
                    timeoutMs: codeSearchTimeoutMs
                });
            } catch (error) {
                state.degraded = true;
                state.reasons.push("code_search_failed");
                if (setup.traceBuilder) {
                    setup.traceBuilder.recordEvent({
                        area: "io",
                        code: "project_search_failed",
                        message: "project_search failed",
                        data: { error: String((error as any)?.message ?? "unknown").slice(0, 120) }
                    });
                }
                codeResults = { results: [] };
            }
        } else {
            codeResults = { results: [] };
        }
        const results = Array.isArray(codeResults?.results) ? codeResults.results : [];
        const topologyMinLOD = resolveAdaptiveFlowLOD(context, 1);
        const codeItems = await Promise.all(results.map(async (item: any) => {
            const codeItem: ExploreItem = {
                kind: "file_preview",
                filePath: item.path ?? "",
                preview: truncate(item.context ?? "", setup.maxItemChars),
                range: item.line ? { startLine: item.line, endLine: item.line } : undefined,
                score: item.score,
                why: [item.type ?? "project_search"],
                metadata: {
                    ...(item?.repoId ? { repoId: item.repoId } : {}),
                    ...(item?.repoRelativePath ? { repoRelativePath: item.repoRelativePath } : {})
                }
            };

            try {
                if (item.path) {
                    const fileSystem = registry.getMetadata<IFileSystem>("fileSystem");
                    const graphSnapshot = await collectTopologyMetadata(ucg, item.path, fileSystem, topologyMinLOD);
                    if (graphSnapshot.topology) {
                        codeItem.metadata = {
                            ...codeItem.metadata,
                            symbols: graphSnapshot.topology.topLevelSymbols?.map((s: any) => `${s.kind === "heading" ? "#" : s.kind === "class" ? "@" : ""}${s.name}`).slice(0, 10),
                            exports: graphSnapshot.topology.exports?.map((e: any) => e.name).slice(0, 5),
                            lod: graphSnapshot.lod,
                            dependencyCount: graphSnapshot.dependencyCount,
                            dependents: graphSnapshot.dependents
                        };
                    }
                }
            } catch (error) {
                console.debug("[ExplorePillar] Topology enrichment skipped:", error);
            }
            return codeItem;
        }));

        codeForPack = codeItems;
        response.data.code = codeItems.slice(0, setup.maxResults).map((item) => applyBudgetToItem(item, false, false));
        if (codeResults?.degraded) {
            state.degraded = true;
            if (codeResults?.reason) {
                state.reasons.push(codeResults.reason);
            }
        }
    }

    const shouldPreferCode = setup.symbolQuery && !setup.input.includeExplicit && !setup.input.sourcesWantsDocs;
    const shouldRunDocSearch = (setup.includeDocs || setup.includeComments)
        && !shouldPreferCode
        && (!setup.hasDeadline || setup.timeRemaining() > 400);

    if (shouldRunDocSearch) {
        if (setup.traceBuilder) {
            setup.traceBuilder.recordEvent({
                area: "policy",
                code: "doc_search_attempted",
                data: { includeDocs: setup.includeDocs, includeComments: setup.includeComments }
            });
        }
        const docCandidateMultiplier = isDeepProfile ? 6 : 3;
        const docMaxCandidatesBase = Math.max(packMaxResults * docCandidateMultiplier, isDeepProfile ? 48 : 24);
        const docMaxCandidates = Math.min(
            docMaxCandidatesBase,
            setup.maxFiles,
            setup.symbolQuery ? 30 : 80
        );
        const docMaxChunkCandidates = Math.min(Math.max(docMaxCandidates * 6, 120), 360);
        const docEmbeddingBudgetMs = setup.hasDeadline
            ? Math.min(1200, Math.max(200, Math.floor(setup.timeRemaining() * 0.4)))
            : undefined;
        const disableEmbeddings = setup.symbolQuery
            || (setup.hasDeadline && typeof docEmbeddingBudgetMs === "number" && docEmbeddingBudgetMs < 400);
        const canRunDocSearch = !setup.hasDeadline || setup.timeRemaining() > 350;
        let docResults: any;
        if (canRunDocSearch) {
            const docSearchTimeoutMs = setup.hasDeadline
                ? Math.max(300, Math.min(1800, Math.floor(setup.timeRemaining() * 0.7)))
                : undefined;
            try {
                docResults = await runTool(context, "document_search", {
                    query,
                    output: "compact",
                    maxResults: packMaxResults,
                    maxCandidates: docMaxCandidates,
                    maxChunkCandidates: docMaxChunkCandidates,
                    maxChunksEmbeddedPerRequest: disableEmbeddings ? 8 : 24,
                    maxEmbeddingTimeMs: docEmbeddingBudgetMs,
                    includeEvidence: false,
                    packId: undefined,
                    includeComments: setup.includeComments,
                    includeLogs: setup.includeLogs,
                    repoScope: (input.constraints as any).repoScope,
                    repoId: (input.constraints as any).repoId,
                    repoIds: (input.constraints as any).repoIds,
                    embedding: disableEmbeddings ? { provider: "disabled" } : undefined,
                    timeoutMs: docSearchTimeoutMs
                });
            } catch (error) {
                state.degraded = true;
                state.reasons.push("doc_search_failed");
                if (setup.traceBuilder) {
                    setup.traceBuilder.recordEvent({
                        area: "io",
                        code: "document_search_failed",
                        message: "document_search failed",
                        data: { error: String((error as any)?.message ?? "unknown").slice(0, 120) }
                    });
                }
                docResults = { results: [] };
            }
        } else {
            state.degraded = true;
            state.reasons.push("budget_exceeded");
            if (setup.traceBuilder) {
                setup.traceBuilder.recordSkip("doc_search", "budget_exceeded", "timeout guard");
            }
            docResults = { results: [] };
        }
        const sections = Array.isArray(docResults?.results) ? docResults.results : [];
        const filtered = sections.filter((section: any) => {
            if (section?.kind === "code_comment") return setup.includeComments;
            if (isLogPath(section?.filePath)) {
                return setup.includeLogs || setup.includeDocs;
            }
            return setup.includeDocs;
        });
        const docs = filtered.map((section: any) => ({
            kind: "document_section",
            filePath: section.filePath ?? "",
            title: section.heading ?? section.sectionPath?.slice?.(-1)?.[0],
            score: section.scores?.final,
            range: { startLine: section.range?.startLine, endLine: section.range?.endLine },
            preview: truncate(section.preview ?? "", setup.maxItemChars),
            metadata: {
                ...(section.kind ? { kind: section.kind } : {}),
                ...(Array.isArray(section.sectionPath) ? { headingPath: section.sectionPath } : {})
            },
            why: ["document_search"]
        }));
        docsForPack = docs;
        response.data.docs = docs.slice(0, setup.maxResults).map((item: ExploreItem) => applyBudgetToItem(item, false, false));
        if (docResults?.degraded) {
            state.degraded = true;
            if (Array.isArray(docResults?.reasons)) {
                state.reasons.push(...docResults.reasons);
            }
        }
    } else if (setup.includeDocs || setup.includeComments) {
        if (!shouldPreferCode) {
            state.degraded = true;
            state.reasons.push("budget_exceeded");
        }
        if (setup.traceBuilder) {
            setup.traceBuilder.recordSkip(
                "doc_search",
                shouldPreferCode ? "sources_filtered" : "budget_exceeded",
                shouldPreferCode ? "symbol query prefers code" : "budget/time limit"
            );
        }
    }

    if (setup.effectivePackId) {
        const createdAt = Date.now();
        const expiresAt = createdAt + DEFAULT_PACK_TTL_MS;
        const pack: ExplorePack = {
            packId: setup.effectivePackId,
            query,
            createdAt,
            expiresAt,
            include: { docs: setup.includeDocs, code: setup.includeCode, comments: setup.includeComments, logs: setup.includeLogs },
            docs: docsForPack,
            code: codeForPack
        };
        packCache.set(setup.effectivePackId, pack);
        response.pack = { packId: setup.effectivePackId, hit: false, createdAt, expiresAt };
        const nextCursor = computeNextCursor(pack, cursorState, setup.maxResults, setup.includeDocs, setup.includeCode, setup.includeComments, setup.includeLogs);
        if (nextCursor) {
            response.next = { itemsCursor: nextCursor };
        }
    }
}
