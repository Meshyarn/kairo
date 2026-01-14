import path from "path";
import { LRUCache } from "lru-cache";
import { InternalToolRegistry } from "../../InternalToolRegistry.js";
import { OrchestrationContext } from "../../OrchestrationContext.js";
import { ParsedIntent } from "../../IntentRouter.js";
import { BudgetManager } from "../../BudgetManager.js";
import { analyzeQuery } from "../../../engine/search/QueryMetrics.js";
import type { QueryMetrics } from "../../../engine/search/QueryMetrics.js";
import { IntegrityEngine } from "../../../integrity/IntegrityEngine.js";
import { UnifiedContextGraph } from "../../context/UnifiedContextGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import { AstManager } from "../../../ast/AstManager.js";
import { ProjectSketchBuilder } from "../../../generation/project-sketch-builder.js";
import type { ResearchPack } from "../../../types/flow-artifacts.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import type { IFileSystem } from "../../../platform/FileSystem.js";
import { OptionResolver } from "../../options/OptionResolver.js";
import { buildDegradedReasons } from "../../DegradedReasonMapper.js";
import { applyTokenBudget, estimateTokens } from "../../TokenBudget.js";
import type { RepoRegistry } from "../../../config/RepoRegistry.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import { resolveRepoInfo } from "../../../utils/RepoScope.js";

import { 
    ExploreItem, 
    ExploreResponse, 
    truncate 
} from "./ResultFormatter.js";
import { 
    ExplorePack, 
    computeExplorePackId, 
    parseItemsCursor, 
    slicePack, 
    computeNextCursor 
} from "./EvidencePackBuilder.js";
import { 
    isDocPath, 
    isLogPath, 
    isSensitivePath, 
    isBinaryPath, 
    applySoftPriority
} from "./FilteringStrategy.js";
import {
    expandPaths,
    collectTopologyMetadata,
    buildItemForPath
} from "./PathExpansion.js";

const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_MAX_FULL_CHARS = 20000;
const DEFAULT_MAX_FILES = 200;
const DEFAULT_PACK_RESULTS = Number.parseInt(process.env.KAIRO_MAX_RESULTS ?? "25", 10) || 25;
const DEFAULT_PACK_TTL_MS = Number.parseInt(process.env.KAIRO_EXPLORE_PACK_TTL_MS ?? "600000", 10) || 600000;
const DEFAULT_PACK_CACHE_SIZE = Number.parseInt(process.env.KAIRO_EXPLORE_PACK_CACHE_SIZE ?? "100", 10) || 100;
const DEFAULT_RESEARCH_TTL_MS = Number.parseInt(process.env.KAIRO_RESEARCH_PACK_TTL_MS ?? "1800000", 10) || 1800000;
const DEFAULT_RESEARCH_CACHE_SIZE = Number.parseInt(process.env.KAIRO_RESEARCH_PACK_CACHE_SIZE ?? "50", 10) || 50;

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
        const startedAt = Date.now();
        const repoRegistry = this.registry.getMetadata<RepoRegistry>("repoRegistry");
        const pathNormalizer = this.registry.getMetadata<PathNormalizer>("pathNormalizer");
        const constraints = intent.constraints as any;
        const query = typeof constraints.query === "string" ? constraints.query : undefined;
        const paths = Array.isArray(constraints.paths) ? constraints.paths : [];
        const research = constraints.research as {
            sketch?: boolean;
            topN?: number;
            format?: "ascii" | "mermaid" | "both";
        } | undefined;
        const rawSessionId = typeof constraints.sessionId === "string" ? constraints.sessionId : undefined;
        const researchRequested = !!research && research?.sketch !== false;
        const packId = typeof constraints.packId === "string" ? constraints.packId : undefined;
        const fullPaths = Array.isArray(constraints.fullPaths) ? constraints.fullPaths : [];
        const allowSensitive = constraints.allowSensitive === true;
        const allowBinary = constraints.allowBinary === true;
        const allowGlobs = constraints.allowGlobs === true;
        const integrityOptions = IntegrityEngine.resolveOptions(constraints.integrity, "explore");
        const artifactManager = this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
        const resolvedSessionId = artifactManager?.resolveSessionId(rawSessionId, intent.originalIntent ?? query ?? "explore");
        const sessionPolicy = resolvedSessionId ? artifactManager?.getSession(resolvedSessionId)?.policy : undefined;

        const resolvedOptions = OptionResolver.resolveExploreOptions(constraints, sessionPolicy);
        const view = resolvedOptions.effective.view;
        const include = resolvedOptions.effective.include;
        const includeExplicit = resolvedOptions.meta.includeExplicit;
        const sourcesWantsDocs = resolvedOptions.meta.sourcesWantsDocs;
        const traceEnabled = resolvedOptions.effective.traceEnabled;
        const profile = resolvedOptions.effective.profile;
        const limits = resolvedOptions.effective.limits as {
            maxResults?: number;
            maxChars?: number;
            maxTokens?: number;
            maxItemChars?: number;
            maxBytes?: number;
            maxFiles?: number;
            timeoutMs?: number;
        };

        const queryMetrics = query ? analyzeQuery(query) : undefined;
        const queryTokens = query ? query.trim().split(/\s+/).filter(Boolean) : [];
        const symbolQuery = queryMetrics ? this.isSymbolLikeQuery(queryMetrics, queryTokens) : false;
        const timeoutMs = Number.isFinite(limits.timeoutMs) && limits.timeoutMs! > 0
            ? limits.timeoutMs!
            : Number.parseInt(process.env.KAIRO_EXPLORE_TIMEOUT_MS ?? "", 10) || undefined;
        const hasDeadline = Number.isFinite(timeoutMs) && timeoutMs! > 0;
        const timeRemaining = () => hasDeadline
            ? Math.max(0, timeoutMs! - (Date.now() - startedAt))
            : Number.POSITIVE_INFINITY;
        let projectStats = context.getState<any>("project_profile");
        if (!projectStats) {
            try {
                projectStats = await this.runTool(context, "project_profile", {});
                if (projectStats) {
                    context.setState("project_profile", projectStats);
                }
            } catch {
                projectStats = undefined;
            }
        }
        const searchBudget = queryMetrics
            ? BudgetManager.create({
                category: "navigate",
                queryLength: queryMetrics.length,
                tokenCount: queryMetrics.tokenCount,
                strongQuery: queryMetrics.strong,
                projectStats: projectStats?.fileCount ? { fileCount: projectStats.fileCount } : undefined
            })
            : undefined;
        if (searchBudget && hasDeadline) {
            searchBudget.maxParseTimeMs = Math.min(searchBudget.maxParseTimeMs, timeoutMs!);
        }

        if (!query && paths.length === 0 && !researchRequested) {
            return {
                success: false,
                status: "invalid_args",
                message: "Missing query or paths.",
                data: { docs: [], code: [] },
                sessionId: resolvedSessionId
            };
        }

        const maxResults = Number.isFinite(limits.maxResults) && limits.maxResults! > 0 ? limits.maxResults! : DEFAULT_MAX_RESULTS;
        const maxChars = Number.isFinite(limits.maxChars) && limits.maxChars! > 0
            ? limits.maxChars!
            : (view === "full" ? DEFAULT_MAX_FULL_CHARS : DEFAULT_MAX_CHARS);
        const envMaxTokens = Number.parseInt(process.env.KAIRO_EXPLORE_MAX_TOKENS ?? process.env.KAIRO_DEFAULT_MAX_TOKENS ?? "", 10);
        const maxTokens = Number.isFinite(limits.maxTokens) && limits.maxTokens! > 0
            ? limits.maxTokens!
            : (Number.isFinite(envMaxTokens) && envMaxTokens > 0 ? envMaxTokens : undefined);
        const maxItemChars = Number.isFinite(limits.maxItemChars) && limits.maxItemChars! > 0
            ? limits.maxItemChars!
            : Math.max(400, Math.floor(maxChars / Math.max(1, maxResults)));
        const maxItemTokens = maxTokens ? Math.max(128, Math.floor(maxTokens / Math.max(1, maxResults))) : undefined;
        const maxBytes = Number.isFinite(limits.maxBytes) && limits.maxBytes! > 0
            ? limits.maxBytes!
            : Number.parseInt(process.env.KAIRO_READ_FILE_MAX_BYTES ?? "0", 10) || undefined;
        const maxFiles = Number.isFinite(limits.maxFiles) && limits.maxFiles! > 0 ? limits.maxFiles! : DEFAULT_MAX_FILES;
        const includeDocs = include.docs !== false;
        const includeCode = include.code !== false;
        const includeComments = include.comments === true;
        const includeLogs = include.logs === true;

        if (searchBudget) {
            const desiredFileBudget = Math.min(
                maxFiles,
                Math.max(12, maxResults * 2)
            );
            searchBudget.maxCandidates = Math.min(searchBudget.maxCandidates, desiredFileBudget);
            searchBudget.maxFilesRead = Math.min(searchBudget.maxFilesRead, desiredFileBudget);
            const perFileCharBudget = Math.max(400, Math.floor(maxChars / Math.max(1, maxResults)));
            searchBudget.maxBytesRead = Math.min(
                searchBudget.maxBytesRead,
                desiredFileBudget * perFileCharBudget
            );
        }

        const packOptions: Record<string, unknown> = {
            include: { docs: includeDocs, code: includeCode, comments: includeComments, logs: includeLogs },
            intent: constraints.intent,
            paths
        };
        if (resolvedOptions.meta.profileAffectsPack && resolvedOptions.effective.profile) {
            packOptions.profile = resolvedOptions.effective.profile;
        }
        if (resolvedOptions.meta.sourcesAffectsPack && resolvedOptions.effective.sources) {
            packOptions.sources = resolvedOptions.effective.sources;
        }
        const effectivePackId = query
            ? (packId ?? computeExplorePackId(query, packOptions))
            : undefined;

        if (resolvedSessionId) {
            const policyPatch: Partial<{ profile?: string; sources?: string; explore?: Record<string, unknown> }> = {};
            if (typeof constraints.profile === "string") {
                policyPatch.profile = constraints.profile;
                policyPatch.explore = { ...(policyPatch.explore ?? {}), profile: constraints.profile };
            }
            if (typeof constraints.sources === "string") {
                policyPatch.sources = constraints.sources;
                policyPatch.explore = { ...(policyPatch.explore ?? {}), sources: constraints.sources };
            }
            if (Object.keys(policyPatch).length > 0) {
                artifactManager?.updateSessionPolicy(resolvedSessionId, policyPatch as any, "merge");
            }
        }

        const response: ExploreResponse = {
            success: true,
            status: "ok",
            query,
            data: { docs: [], code: [] },
            sessionId: resolvedSessionId
        };
        const decisionTrace = traceEnabled ? {
            cache: {} as Record<string, unknown>,
            docSearch: {} as Record<string, unknown>,
            heuristic: { symbolLikeQuery: symbolQuery },
            budget: { timeoutMs }
        } : undefined;

        if (researchRequested) {
            response.researchPack = await this.buildResearchPack(research, resolvedSessionId, intent.originalIntent).catch(() => undefined);
            if (!response.researchPack) {
                response.insights = response.insights || [];
                response.insights.push({
                    type: "warning",
                    message: "Research pack generation failed. Ensure dependency graph indexing is available.",
                    relatedSymbols: []
                });
            }
        }

        if (!query && paths.length === 0) {
            this.addIndexStatusInsights(response);
            await this.attachIndexSnapshot(response);
            return response;
        }
        if (integrityOptions && integrityOptions.mode !== "off") {
            const integrityQuery = query ?? (paths.length > 0 ? path.basename(paths[0]) : undefined);
            const integrityResult = await IntegrityEngine.run(
                {
                    query: integrityQuery,
                    targetPaths: paths,
                    scope: integrityOptions.scope ?? "auto",
                    sources: integrityOptions.sources ?? [],
                    limits: integrityOptions.limits ?? {},
                    mode: integrityOptions.mode ?? "warn"
                },
                (tool, args) => this.runTool(context, tool, args)
            );
            response.integrity = integrityResult.report;
        }

        const reasons: string[] = [];
        let degraded = false;
        let budgetExceeded = false;
        let totalChars = 0;
        let totalTokens = 0;
        let compressionEstimatedTokens = 0;
        let compressionUsedChars = 0;
        const compressionDecisions: Array<{
            item: string;
            from: "full" | "skeleton" | "reference" | "summary";
            to: "full" | "skeleton" | "reference" | "summary";
            reason: "budget_exceeded" | "low_score" | "distance";
        }> = [];

        const applyBudgetToItem = (
            item: ExploreItem,
            isFullContent: boolean,
            allowDistill: boolean
        ): ExploreItem => {
            const text = isFullContent ? item.content : item.preview;
            if (!text) return item;
            const languageId = isDocPath(item.filePath) ? undefined : AstManager.getInstance().getLanguageId(item.filePath);
            const budget = applyTokenBudget(text, {
                maxTokens: maxItemTokens,
                maxChars: isFullContent ? maxChars : maxItemChars,
                languageId
            });
            compressionEstimatedTokens += budget.estimatedTokens ?? 0;
            compressionUsedChars += budget.usedChars;
            if (budget.applied) {
                budgetExceeded = true;
            }
            if (isFullContent && allowDistill && budget.applied) {
                item.preview = truncate(budget.text, maxItemChars);
                item.content = undefined;
                compressionDecisions.push({
                    item: item.filePath,
                    from: "full",
                    to: "skeleton",
                    reason: "budget_exceeded"
                });
            } else if (isFullContent) {
                item.content = budget.text;
            } else {
                item.preview = budget.text;
            }
            return item;
        };

        if (query) {
            const cursorState = parseItemsCursor(constraints.cursor?.items);
            const contentCursorState = parseItemsCursor(constraints.cursor?.content);
            const cachedPack = effectivePackId ? ExplorePillar.packCache.get(effectivePackId) : undefined;
            if (cachedPack) {
                if (decisionTrace) {
                    decisionTrace.cache = { packHit: true, packId: cachedPack.packId };
                    decisionTrace.docSearch = { attempted: false, skippedReason: "cache_hit" };
                }
                if (constraints.cursor?.content) {
                    const sliced = slicePack(cachedPack, contentCursorState, maxResults, includeDocs, includeCode, includeComments, includeLogs);
                    const expandedDocs = await Promise.all(sliced.docs.map((item) => this.expandDocContent(item, maxChars, context)));
                    const expandedCode = await Promise.all(sliced.code.map((item) => this.expandCodeContent(item, maxChars, context)));

                    const applyBudgetWithGlobalLimit = (items: ExploreItem[]) => {
                        const results: ExploreItem[] = [];
                        for (const item of items) {
                            if (degraded && reasons.includes("budget_exceeded")) break;

                            const processed = applyBudgetToItem(item, true, view !== "full");
                            if (maxTokens) {
                                const content = processed.content ?? processed.preview ?? "";
                                const itemTokens = estimateTokens(content, {
                                    languageId: isDocPath(processed.filePath) ? undefined : AstManager.getInstance().getLanguageId(processed.filePath)
                                });
                                if (totalTokens + itemTokens > maxTokens) {
                                    degraded = true;
                                    reasons.push("budget_exceeded");
                                    break;
                                }
                                totalTokens += itemTokens;
                            }
                            results.push(processed);
                        }
                        return results;
                    };

                    response.data.docs = applyBudgetWithGlobalLimit(expandedDocs);
                    response.data.code = applyBudgetWithGlobalLimit(expandedCode);
                    if (sliced.nextCursor) {
                        response.next = { contentCursor: sliced.nextCursor };
                    }
                } else {
                    const sliced = slicePack(cachedPack, cursorState, maxResults, includeDocs, includeCode, includeComments, includeLogs);
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
            } else {
                if (decisionTrace) {
                    decisionTrace.cache = { packHit: false };
                }
                const isDeepProfile = profile === "deep";
                const packMaxResults = Math.max(maxResults, DEFAULT_PACK_RESULTS, isDeepProfile ? 40 : 0);
                let docsForPack: ExploreItem[] = [];
                let codeForPack: ExploreItem[] = [];

                const ucg = context.getState<UnifiedContextGraph>('ucg');

                if (includeCode) {
                    let codeResults: any;
                    try {
                        codeResults = await this.runTool(context, "project_search", {
                            query,
                            maxResults: packMaxResults,
                            type: "file",
                            repoScope: (constraints as any).repoScope,
                            repoId: (constraints as any).repoId,
                            repoIds: (constraints as any).repoIds,
                            budget: searchBudget
                        });
                    } catch (error) {
                        degraded = true;
                        reasons.push("code_search_failed");
                        if (decisionTrace) {
                            decisionTrace.cache = {
                                ...(decisionTrace.cache ?? {}),
                                codeSearchError: String((error as any)?.message ?? "unknown")
                            };
                        }
                        codeResults = { results: [] };
                    }
                    const results = Array.isArray(codeResults?.results) ? codeResults.results : [];
                    
                    const codeItems = await Promise.all(results.map(async (item: any) => {
                        const codeItem: ExploreItem = {
                            kind: "file_preview",
                            filePath: item.path ?? "",
                            preview: truncate(item.context ?? "", maxItemChars),
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
                                const fileSystem = this.registry.getMetadata<IFileSystem>("fileSystem");
                                const graphSnapshot = await collectTopologyMetadata(ucg, item.path, fileSystem);
                                if (graphSnapshot.topology) {
                                    codeItem.metadata = {
                                        ...codeItem.metadata,
                                        symbols: graphSnapshot.topology.topLevelSymbols?.map((s: any) => `${s.kind === 'heading' ? '#' : s.kind === 'class' ? '@' : ''}${s.name}`).slice(0, 10),
                                        exports: graphSnapshot.topology.exports?.map((e: any) => e.name).slice(0, 5),
                                        lod: graphSnapshot.lod,
                                        dependencyCount: graphSnapshot.dependencyCount,
                                        dependents: graphSnapshot.dependents
                                    };
                                }
                            }
                        } catch (error) {
                            console.debug('[ExplorePillar] Topology enrichment skipped:', error);
                        }
                        return codeItem;
                    }));

                    codeForPack = codeItems;
                    response.data.code = codeItems.slice(0, maxResults).map((item) => applyBudgetToItem(item, false, false));
                    if (codeResults?.degraded) {
                        degraded = true;
                        if (codeResults?.reason) {
                            reasons.push(codeResults.reason);
                        }
                    }
                }

                const shouldPreferCode = symbolQuery && !includeExplicit && !sourcesWantsDocs;
                const shouldRunDocSearch = (includeDocs || includeComments)
                    && !shouldPreferCode
                    && (!hasDeadline || timeRemaining() > 400);

                if (shouldRunDocSearch) {
                    if (decisionTrace) {
                        decisionTrace.docSearch = { attempted: true };
                    }
                    const docCandidateMultiplier = isDeepProfile ? 6 : 3;
                    const docMaxCandidatesBase = Math.max(packMaxResults * docCandidateMultiplier, isDeepProfile ? 48 : 24);
                    const docMaxCandidates = Math.min(
                        docMaxCandidatesBase,
                        maxFiles,
                        symbolQuery ? 30 : 80
                    );
                    const docMaxChunkCandidates = Math.min(Math.max(docMaxCandidates * 6, 120), 360);
                    const docEmbeddingBudgetMs = hasDeadline
                        ? Math.min(1200, Math.max(200, Math.floor(timeRemaining() * 0.4)))
                        : undefined;
                    const disableEmbeddings = symbolQuery
                        || (hasDeadline && typeof docEmbeddingBudgetMs === "number" && docEmbeddingBudgetMs < 400);
                    let docResults: any;
                    try {
                        docResults = await this.runTool(context, "document_search", {
                            query,
                            output: "compact",
                            maxResults: packMaxResults,
                            maxCandidates: docMaxCandidates,
                            maxChunkCandidates: docMaxChunkCandidates,
                            maxChunksEmbeddedPerRequest: disableEmbeddings ? 8 : 24,
                            maxEmbeddingTimeMs: docEmbeddingBudgetMs,
                            includeEvidence: false,
                            packId: undefined,
                            includeComments,
                            includeLogs,
                            repoScope: (constraints as any).repoScope,
                            repoId: (constraints as any).repoId,
                            repoIds: (constraints as any).repoIds,
                            embedding: disableEmbeddings ? { provider: "disabled" } : undefined
                        });
                    } catch (error) {
                        degraded = true;
                        reasons.push("doc_search_failed");
                        if (decisionTrace) {
                            decisionTrace.docSearch = {
                                attempted: true,
                                error: String((error as any)?.message ?? "unknown")
                            };
                        }
                        docResults = { results: [] };
                    }
                    const sections = Array.isArray(docResults?.results) ? docResults.results : [];
                    const filtered = sections.filter((section: any) => {
                        if (section?.kind === "code_comment") return includeComments;
                        if (isLogPath(section?.filePath)) {
                            return includeLogs || includeDocs;
                        }
                        return includeDocs;
                    });
                    const docs = filtered.map((section: any) => ({
                        kind: "document_section",
                        filePath: section.filePath ?? "",
                        title: section.heading ?? section.sectionPath?.slice?.(-1)?.[0],
                        score: section.scores?.final,
                        range: { startLine: section.range?.startLine, endLine: section.range?.endLine },
                        preview: truncate(section.preview ?? "", maxItemChars),
                        metadata: {
                            ...(section.kind ? { kind: section.kind } : {}),
                            ...(Array.isArray(section.sectionPath) ? { headingPath: section.sectionPath } : {})
                        },
                        why: ["document_search"]
                    }));
                    docsForPack = docs;
                    response.data.docs = docs.slice(0, maxResults).map((item: ExploreItem) => applyBudgetToItem(item, false, false));
                    if (docResults?.degraded) {
                        degraded = true;
                        if (Array.isArray(docResults?.reasons)) {
                            reasons.push(...docResults.reasons);
                        }
                    }
                } else if (includeDocs || includeComments) {
                    degraded = true;
                    reasons.push(shouldPreferCode ? "doc_search_skipped" : "budget_exceeded");
                    if (decisionTrace) {
                        decisionTrace.docSearch = {
                            attempted: false,
                            skippedReason: shouldPreferCode ? "doc_search_skipped" : "budget_exceeded"
                        };
                    }
                }

                if (effectivePackId) {
                    const createdAt = Date.now();
                    const expiresAt = createdAt + DEFAULT_PACK_TTL_MS;
                    const pack: ExplorePack = {
                        packId: effectivePackId,
                        query,
                        createdAt,
                        expiresAt,
                        include: { docs: includeDocs, code: includeCode, comments: includeComments, logs: includeLogs },
                        docs: docsForPack,
                        code: codeForPack
                    };
                    ExplorePillar.packCache.set(effectivePackId, pack);
                    response.pack = { packId: effectivePackId, hit: false, createdAt, expiresAt };
                    const nextCursor = computeNextCursor(pack, cursorState, maxResults, includeDocs, includeCode, includeComments, includeLogs);
                    if (nextCursor) {
                        response.next = { itemsCursor: nextCursor };
                    }
                }
            }
        }

        if (paths.length > 0) {
            const expanded = await expandPaths(paths, { allowGlobs, maxFiles, includeDocs, includeCode }, this.registry);

            if (expanded.blocked) {
                return {
                    success: false,
                    status: "invalid_args",
                    message: expanded.message ?? "Invalid paths.",
                    data: { docs: [], code: [] },
                    sessionId: resolvedSessionId
                };
            }

            const selected = applySoftPriority(expanded.entries, maxFiles, includeDocs, includeCode);
            const fullPathSet = new Set(fullPaths);

            for (const entry of selected) {
                if (!includeDocs && isDocPath(entry.path)) continue;
                if (!includeCode && !isDocPath(entry.path)) continue;

                const wantsFull = view === "full" && (fullPaths.length === 0 || fullPathSet.has(entry.path));
                if (wantsFull) {
                    if (!allowSensitive && isSensitivePath(entry.path)) {
                        return {
                            success: false,
                            status: "blocked",
                            message: `Full read blocked for sensitive path: ${entry.path}`,
                            data: { docs: [], code: [] },
                            sessionId: resolvedSessionId
                        };
                    }
                    if (!allowBinary && isBinaryPath(entry.path)) {
                        return {
                            success: false,
                            status: "blocked",
                            message: `Full read blocked for binary path: ${entry.path}`,
                            data: { docs: [], code: [] },
                            sessionId: resolvedSessionId
                        };
                    }
                    if (typeof maxBytes === "number" && entry.size && entry.size > maxBytes) {
                        return {
                            success: false,
                            status: "blocked",
                            message: `Full read blocked by maxBytes for ${entry.path}.`,
                            data: { docs: [], code: [] },
                            sessionId: resolvedSessionId
                        };
                    }
                }

                const fileSystem = this.registry.getMetadata<IFileSystem>("fileSystem");
                const item = await buildItemForPath(entry.path, { view, maxChars, maxItemChars, allowSensitive, allowBinary, wantsFull, section: constraints.section }, context, (ctx, tool, args) => this.runTool(ctx, tool, args), fileSystem);

                if (item.blocked) {
                    let reason = item.reason;
                    if (!reason && typeof item.message === "string" && item.message.includes("Syntax validation failed")) {
                        reason = "syntax_validation_failed";
                    }
                    const reasons = reason ? [reason] : undefined;
                    const languageId = reason ? AstManager.getInstance().getLanguageId(entry.path) : undefined;
                    const degradedReasons = reasons
                        ? buildDegradedReasons(reasons, { languageId, filePath: entry.path })
                        : undefined;
                    return {
                        success: false,
                        status: "blocked",
                        message: item.message ?? "Full read blocked.",
                        data: { docs: [], code: [] },
                        reasons,
                        degradedReasons,
                        sessionId: resolvedSessionId
                    };
                }

                if (item.degraded) {
                    degraded = true;
                    if (item.reason) reasons.push(item.reason);
                }

                const payloadItem = item.value;
                if (!payloadItem) continue;

                const isFullContent = typeof payloadItem.content === "string";
                applyBudgetToItem(payloadItem, isFullContent, view !== "full");

                if (repoRegistry && pathNormalizer) {
                    try {
                        const repoInfo = resolveRepoInfo(payloadItem.filePath, repoRegistry, pathNormalizer);
                        payloadItem.metadata = {
                            ...(payloadItem.metadata ?? {}),
                            repoId: repoInfo.repoId,
                            ...(repoInfo.repoRelativePath ? { repoRelativePath: repoInfo.repoRelativePath } : {})
                        };
                    } catch {
                        // ignore repo scope metadata failures
                    }
                }

                const contentText = payloadItem.content ?? payloadItem.preview ?? "";
                const contentLength = contentText.length;
                const itemTokens = estimateTokens(contentText, {
                    languageId: isDocPath(payloadItem.filePath) ? undefined : AstManager.getInstance().getLanguageId(payloadItem.filePath)
                });
                if (maxTokens) {
                    if (view === "full") {
                        if (totalTokens + itemTokens > maxTokens) {
                            return {
                                success: false,
                                status: "blocked",
                                message: "Full read blocked by maxTokens. Increase limits.maxTokens and retry.",
                                data: { docs: [], code: [] },
                                sessionId: resolvedSessionId
                            };
                        }
                    } else if (totalTokens + itemTokens > maxTokens) {
                        degraded = true;
                        reasons.push("budget_exceeded");
                        break;
                    }
                }
                if (view === "full") {
                    if (totalChars + contentLength > maxChars) {
                        return {
                            success: false,
                            status: "blocked",
                            message: "Full read blocked by maxChars. Increase limits.maxChars and retry.",
                            data: { docs: [], code: [] },
                            sessionId: resolvedSessionId
                        };
                    }
                } else {
                    if (totalChars + contentLength > maxChars) {
                        degraded = true;
                        reasons.push("budget_exceeded");
                        break;
                    }
                }
                totalChars += contentLength;
                totalTokens += itemTokens;

                if (isDocPath(entry.path)) {
                    response.data.docs.push(payloadItem);
                } else {
                    response.data.code.push(payloadItem);
                }
            }
        }

        if (response.data.docs.length === 0 && response.data.code.length === 0) {
            response.status = "no_results";
            response.message = "No results found.";
        }

        if (budgetExceeded) {
            degraded = true;
            reasons.push("budget_exceeded");
            response.compression = {
                applied: true,
                mode: compressionDecisions.length > 0 ? "distill" : "truncate",
                elasticWindowPct: maxTokens ? 0.05 : undefined,
                maxTokens,
                estimatedTokens: compressionEstimatedTokens > 0 ? compressionEstimatedTokens : undefined,
                maxChars,
                usedChars: compressionUsedChars > 0 ? compressionUsedChars : undefined,
                decisions: compressionDecisions.length > 0 ? compressionDecisions : undefined
            };
        }

        if (degraded) {
            response.degraded = true;
            response.reasons = Array.from(new Set(reasons));
            response.degradedReasons = buildDegradedReasons(response.reasons);
        }

        if (traceEnabled) {
            response.effectiveOptions = {
                profile: resolvedOptions.effective.profile,
                sources: resolvedOptions.effective.sources,
                include,
                limits,
                view
            };
            response.decisionTrace = decisionTrace;
        }

        this.addIndexStatusInsights(response);
        await this.attachIndexSnapshot(response);

        return response;
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

    private async expandDocContent(item: ExploreItem, maxChars: number, context: OrchestrationContext): Promise<ExploreItem> {
        const headingPath = Array.isArray(item.metadata?.headingPath) ? item.metadata?.headingPath : undefined;
        const result = await this.runTool(context, "document_section", {
            filePath: item.filePath,
            headingPath,
            includeSubsections: false,
            mode: "raw",
            maxChars
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
